import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aiVisibilityRunInputSchema,
  aiVisibilityExploreInputSchema,
  aiVisibilityResearchInputSchema,
  aiVisibilityEstimateInputSchema,
  runAiVisibilityRun,
  runAiVisibilityExplore,
  runAiVisibilityResearch,
  runAiVisibilityEstimate,
  digestResearch,
} from './ai-visibility-paid.js'
import { trackerSaveInputSchema, runTrackerSave } from './ai-visibility-local.js'
import { StateStore } from '../utils/state-store.js'
import { loadRuns } from './ai-visibility/store.js'
import { resetPriceCache } from '../utils/paid-gate.js'
import { resetSpend } from '../utils/spend-guard.js'
import { dispatchTool } from '../dispatch.js'
import { CLIExecutor } from '../cli/executor.js'

const PRICE_TREE = {
  serp: { live: { advanced: { priority_normal: [{ cost_type: 'per_request', cost: 0.002 }] } } },
  ai_optimization: {
    llm_scraper: { live: { advanced: { priority_normal: [{ cost_type: 'per_request', cost: 0.004 }] } } },
    llm_responses: { live: { priority_normal: [{ cost_type: 'per_request', cost: 0.0006 }] } },
    llm_mentions: {
      search: {
        live: {
          priority_normal: [
            { cost_type: 'per_result', cost: 0.001 },
            { cost_type: 'per_request', cost: 0.1 },
          ],
        },
      },
    },
  },
}

function fixtureBody(name: string): string {
  return readFileSync(new URL(`./__fixtures__/ai-visibility/${name}.json`, import.meta.url), 'utf8')
}

const MENTIONS_RESULT = {
  status_code: 20000,
  tasks: [
    {
      status_code: 20000,
      cost: 0.12,
      result: [
        {
          items: [
            {
              question: 'which open source analytics tool is best',
              answer: 'ToolA or ToolB.',
              ai_search_volume: 900,
              sources: [
                { domain: 'toolb.example.com', url: 'https://toolb.example.com/' },
                { domain: 'reviews.example.net', url: 'https://reviews.example.net/' },
              ],
            },
            { question: 'is ToolA free', answer: 'Yes.', ai_search_volume: 40, sources: [{ domain: 'toola.example.com', url: 'https://toola.example.com/' }] },
            { question: 'Which open source analytics tool is best', answer: 'dup', sources: [] },
          ],
        },
      ],
    },
  ],
}

let balance = 10
let failPaths: RegExp | null = null

function mockFetch() {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/appendix/user_data')) {
      return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance }, price: PRICE_TREE }] }] }))
    }
    if (failPaths && failPaths.test(url)) return new Response('upstream broke', { status: 500 })
    if (url.includes('/chat_gpt/llm_scraper/')) return new Response(fixtureBody('chatgpt-scraper'))
    if (url.includes('/gemini/llm_scraper/')) return new Response(fixtureBody('gemini-scraper'))
    if (url.includes('/serp/google/ai_mode/')) return new Response(fixtureBody('google-ai-mode'))
    if (url.includes('/serp/google/organic/')) return new Response(fixtureBody('google-ai-overview'))
    if (url.includes('/claude/llm_responses/')) return new Response(fixtureBody('claude-llm-responses'))
    if (url.includes('/llm_mentions/search/')) return new Response(JSON.stringify(MENTIONS_RESULT))
    return new Response('not mocked: ' + url, { status: 404 })
  })
}

let dir: string

function saveTracker(models: string[] = ['chatgpt', 'google_ai_overview', 'google_ai_mode']) {
  return runTrackerSave(
    trackerSaveInputSchema.parse({
      site: 'toolb.example.com',
      state_dir: dir,
      prompts: [{ text: 'what are the best open source web analytics tools', tags: ['category'] }, { text: 'toolb reviews', tags: ['brand'] }],
      models,
      brand_terms: ['ToolB'],
      competitors: [{ domain: 'toola.example.com', name: 'ToolA' }, { domain: 'toolc.example.org', name: 'ToolC' }],
    }),
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ga4-aivis-'))
  balance = 10
  failPaths = null
  resetPriceCache()
  resetSpend()
  vi.stubEnv('DATAFORSEO_USERNAME', 'u')
  vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('ai_visibility_estimate', () => {
  it('prices prompts × models from the live price list, with surcharges, spending nothing', async () => {
    const fetchMock = mockFetch()
    saveTracker()
    const out = (await runAiVisibilityEstimate(aiVisibilityEstimateInputSchema.parse({ site: 'toolb.example.com', state_dir: dir }))) as Record<string, unknown>
    expect(out).toMatchObject({ success: true, estimate_only: true, would_run: true, requests: 6, prompts: 2, balance_usd: 10 })
    // 2 × (0.004 chatgpt + (0.002+0.002) AI Overview + (0.002+0.002) AI Mode) = 0.024
    expect((out.estimate as { total_usd: number }).total_usd).toBe(0.024)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a missing tracker as NOT_FOUND', async () => {
    mockFetch()
    const out = await runAiVisibilityEstimate(aiVisibilityEstimateInputSchema.parse({ site: 'toolb.example.com', state_dir: dir }))
    expect(out).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('ai_visibility_run', () => {
  it('runs every prompt × engine, stores the run and summarizes visibility', async () => {
    mockFetch()
    saveTracker()
    const out = (await runAiVisibilityRun(aiVisibilityRunInputSchema.parse({ site: 'toolb.example.com', state_dir: dir }))) as Record<string, unknown>
    expect(out).toMatchObject({ success: true, prompts: 2, models: ['chatgpt', 'google_ai_overview', 'google_ai_mode'], failed: [] })
    expect(out.cost_usd).toBe(0.024)
    const summary = out.summary as { model: string; mention_rate: number; citation_rate: number }[]
    expect(summary.find((s) => s.model === 'chatgpt')).toMatchObject({ mention_rate: 1, citation_rate: 0 })
    expect(summary.find((s) => s.model === 'google_ai_mode')).toMatchObject({ mention_rate: 1, citation_rate: 1 })
    expect(summary.find((s) => s.model === 'google_ai_overview')).toMatchObject({ mention_rate: 0, citation_rate: 0 })
    const runs = loadRuns(new StateStore(dir), 'toolb.example.com')
    expect(runs).toHaveLength(1)
    expect(runs[0].answers).toHaveLength(6)
    expect(runs[0].id).toBe(out.run_id)
  })

  it('keeps failed cells in the run and filters prompts by tag', async () => {
    mockFetch()
    failPaths = /ai_mode/
    saveTracker()
    const out = (await runAiVisibilityRun(aiVisibilityRunInputSchema.parse({ site: 'toolb.example.com', state_dir: dir, tags: ['brand'] }))) as Record<string, unknown>
    expect(out).toMatchObject({ success: true, prompts: 1 })
    expect(out.failed).toEqual([{ prompt: 'toolb reviews', model: 'google_ai_mode', error: expect.stringContaining('HTTP 500') }])
  })

  it('refuses above max_cost_usd without calling any paid endpoint', async () => {
    const fetchMock = mockFetch()
    saveTracker()
    const out = await runAiVisibilityRun(aiVisibilityRunInputSchema.parse({ site: 'toolb.example.com', state_dir: dir, max_cost_usd: 0.01 }))
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    expect(fetchMock.mock.calls.every(([u]) => String(u).endsWith('/appendix/user_data'))).toBe(true)
  })

  it('refuses when the balance is too low', async () => {
    mockFetch()
    balance = 0.001
    saveTracker()
    const out = await runAiVisibilityRun(aiVisibilityRunInputSchema.parse({ site: 'toolb.example.com', state_dir: dir }))
    expect(out).toMatchObject({ success: false, error: { code: 'QUOTA_EXCEEDED' } })
  })

  it('second run through the dispatcher comes from cache at no cost', async () => {
    const fetchMock = mockFetch()
    saveTracker(['chatgpt'])
    const executor = new CLIExecutor('/nonexistent/ga4')
    const args = { site: 'toolb.example.com', state_dir: dir }
    const first = await dispatchTool('ai_visibility_run', args, executor)
    expect(first.isError).toBe(false)
    const paidCalls = () => fetchMock.mock.calls.filter(([u]) => !String(u).endsWith('/appendix/user_data')).length
    expect(paidCalls()).toBe(2)
    const second = (await dispatchTool('ai_visibility_run', args, executor)).output as Record<string, unknown>
    expect(paidCalls()).toBe(2)
    expect(second).toMatchObject({ success: true, cost_usd: 0, cache: { hits: 2, misses: 0 } })
    expect((second.estimate as { total_usd: number }).total_usd).toBe(0)
  })
})

describe('ai_visibility_explore', () => {
  it('asks one prompt across engines and analyses each answer without storing a run', async () => {
    mockFetch()
    const out = (await runAiVisibilityExplore(
      aiVisibilityExploreInputSchema.parse({
        site: 'toolb.example.com',
        state_dir: dir,
        prompt: 'what are the best open source web analytics tools',
        models: ['claude', 'google_ai_mode'],
        brand_terms: ['ToolB'],
        competitors: [{ domain: 'toola.example.com', name: 'ToolA' }],
        max_answer_chars: 200,
      }),
    )) as { success: boolean; answers: { model: string; analysis: { mentioned: boolean; cited: boolean } }[] }
    expect(out.success).toBe(true)
    expect(out.answers.map((a) => [a.model, a.analysis.mentioned, a.analysis.cited])).toEqual([
      ['claude', true, true],
      ['google_ai_mode', true, true],
    ])
    expect(loadRuns(new StateStore(dir), 'toolb.example.com')).toHaveLength(0)
  })

  it('estimate_only returns the estimate', async () => {
    mockFetch()
    const out = await runAiVisibilityExplore(
      aiVisibilityExploreInputSchema.parse({ site: 'toolb.example.com', state_dir: dir, prompt: 'abc', models: ['claude'], estimate_only: true }),
    )
    // 0.0006 request + 0.01 token allowance + 0.005 surcharge
    expect(out).toMatchObject({ success: true, estimate_only: true, estimate: { total_usd: 0.0156 } })
  })
})

describe('ai_visibility_research', () => {
  it('digests questions, volumes and cited domains', () => {
    const d = digestResearch([{ keyword: 'web analytics', items: MENTIONS_RESULT.tasks[0].result[0].items }], 'toolb.example.com')
    expect(d.questions).toEqual([
      { question: 'which open source analytics tool is best', keyword: 'web analytics', ai_search_volume: 900, source_count: 2, cites_site: true, relevance: 0.5 },
    ])
    // No topic word from the seed: kept for review, not suggested (B6).
    expect(d.low_relevance).toEqual([{ question: 'is ToolA free', keyword: 'web analytics', ai_search_volume: 40, source_count: 1, cites_site: false, relevance: 0 }])
    expect(d.top_cited_domains[0]).toEqual({ domain: 'reviews.example.net', citations: 1, is_own: false })
    expect(d.top_cited_domains.find((x) => x.is_own)).toMatchObject({ domain: 'toolb.example.com' })
  })

  it('gates, calls LLM Mentions per keyword and suggests prompts', async () => {
    mockFetch()
    const out = (await runAiVisibilityResearch(
      aiVisibilityResearchInputSchema.parse({ site: 'toolb.example.com', keywords: ['web analytics'], limit: 20 }),
    )) as Record<string, unknown>
    expect(out).toMatchObject({ success: true, cost_usd: 0.12, suggested_prompts: ['which open source analytics tool is best'] })
    // 0.1 per request + 20 × 0.001 per result
    expect((out.estimate as { total_usd: number }).total_usd).toBe(0.12)
  })
})

describe('research relevance (B6)', () => {
  it('keeps on-topic questions and sets loose matches aside', async () => {
    const { digestResearch, relevanceTo } = await import('./ai-visibility-paid.js')
    expect(relevanceTo('app mantenimiento moto', 'app motos')).toBe(0.5)
    expect(relevanceTo('app mantenimiento moto', 'mantenimiento de motos')).toBe(1)
    expect(relevanceTo('app mantenimiento moto', 'uber eats repartidor')).toBe(0)
    const d = digestResearch([{ keyword: 'app mantenimiento moto', items: [
      { question: 'uber eats repartidor', ai_search_volume: 1600, sources: [] },
      { question: 'mantenimiento de motos', ai_search_volume: 90, sources: [] },
      { question: 'apps moto', ai_search_volume: 300, sources: [] },
    ] }], 'example.com')
    expect(d.questions.map((q) => q.question)).toEqual(['mantenimiento de motos', 'apps moto'])
    expect(d.low_relevance.map((q) => q.question)).toEqual(['uber eats repartidor'])
  })
})
