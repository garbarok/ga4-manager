import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { priceRequests, pricePathFor, lookupPrice, pagesFor, gatePaidRun, resetPriceCache } from './paid-gate.js'
import { dataforseoRequest } from './dataforseo-client.js'
import { runWithContext, type ToolContext } from './tool-context.js'
import { resetSpend } from './spend-guard.js'

const TREE = {
  serp: { live: { advanced: { priority_normal: [{ cost_type: 'per_request', cost: 0.002 }] } } },
  dataforseo_labs: {
    serp_competitors: {
      live: {
        priority_normal: [
          { cost_type: 'per_result', cost: 0.0001 },
          { cost_type: 'per_request', cost: 0.01 },
        ],
      },
    },
  },
}

function userDataResponse(balance: number) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance }, price: TREE }] }] }),
    { status: 200 },
  )
}

describe('price lookup', () => {
  it('drops engine segments the price tree does not have', () => {
    expect(pricePathFor('serp/google/organic/live/advanced')).toBe('serp/live/advanced')
    expect(pricePathFor('ai_optimization/chat_gpt/llm_scraper/live/advanced')).toBe('ai_optimization/llm_scraper/live/advanced')
    expect(pricePathFor('dataforseo_labs/google/serp_competitors/live')).toBe('dataforseo_labs/serp_competitors/live')
  })
  it('sums per-request and per-result leaves, and falls back to built-ins', () => {
    expect(lookupPrice(TREE, 'dataforseo_labs/google/serp_competitors/live')).toEqual({ per_request: 0.01, per_result: 0.0001 })
    expect(lookupPrice(null, 'serp/google/organic/live/advanced')).toEqual({ per_request: 0.002, per_result: 0 })
    expect(lookupPrice(null, 'nope/x')).toBeNull()
  })
  it('bills SERP depth per 10 results', () => {
    expect(pagesFor('serp/google/organic/live/advanced', { depth: 100 })).toBe(10)
    expect(pagesFor('serp/google/organic/live/advanced', {})).toBe(1)
    expect(pagesFor('dataforseo_labs/google/serp_competitors/live', { depth: 100 })).toBe(1)
  })
})

describe('priceRequests', () => {
  it('groups lines by endpoint and counts cached requests as free', () => {
    const plan = [
      { path: 'serp/google/organic/live/advanced', task: { keyword: 'a', depth: 20 } },
      { path: 'serp/google/organic/live/advanced', task: { keyword: 'b', depth: 20 } },
      { path: 'dataforseo_labs/google/serp_competitors/live', task: { keywords: ['a'] }, expected_results: 100 },
    ]
    const est = priceRequests(plan, TREE, (r) => r.task.keyword === 'b')
    expect(est.total_usd).toBe(0.004 + 0.02)
    expect(est.cached_requests).toBe(1)
    expect(est.lines[0]).toMatchObject({ requests: 2, cached_requests: 1, pages_per_request: 2, subtotal_usd: 0.004 })
    expect(est.price_source).toBe('live')
  })
  it('adds a measured surcharge unless the request is cached', () => {
    const plan = [
      { path: 'serp/google/ai_mode/live/advanced', task: { keyword: 'a' }, surcharge_usd: 0.002 },
      { path: 'serp/google/ai_mode/live/advanced', task: { keyword: 'b' }, surcharge_usd: 0.002 },
    ]
    expect(priceRequests(plan, TREE, (r) => r.task.keyword === 'b').total_usd).toBe(0.004)
  })
  it('notes unknown endpoints and LLM token allowance', () => {
    const est = priceRequests(
      [
        { path: 'mystery/live', task: {} },
        { path: 'ai_optimization/claude/llm_responses/live', task: {} },
      ],
      null,
    )
    expect(est.notes.join(' ')).toMatch(/no known price/)
    expect(est.notes.join(' ')).toMatch(/model tokens/)
    expect(est.total_usd).toBeCloseTo(0.0106, 6)
  })
})

describe('gatePaidRun', () => {
  const plan = [{ path: 'serp/google/organic/live/advanced', task: { keyword: 'k', depth: 100 } }] // $0.02
  beforeEach(() => {
    resetPriceCache()
    resetSpend()
    vi.stubEnv('DATAFORSEO_USERNAME', 'u')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('estimate_only returns the estimate without spending', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(userDataResponse(10))
    const out = await gatePaidRun(plan, { max_cost_usd: 1, estimate_only: true })
    expect(out.proceed).toBe(false)
    if (!out.proceed) expect(out.output).toMatchObject({ success: true, estimate_only: true, would_run: true, balance_usd: 10 })
  })

  it('refuses above max_cost_usd', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(userDataResponse(10))
    const out = await gatePaidRun(plan, { max_cost_usd: 0.01, estimate_only: false })
    expect(out.proceed).toBe(false)
    if (!out.proceed) expect(out.output).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })

  it('refuses when the balance is below the estimate', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(userDataResponse(0.01))
    const out = await gatePaidRun(plan, { max_cost_usd: 5, estimate_only: false })
    expect(out.proceed).toBe(false)
    if (!out.proceed) expect(out.output).toMatchObject({ success: false, error: { code: 'QUOTA_EXCEEDED' } })
  })

  it('proceeds within cap and balance', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(userDataResponse(10))
    const out = await gatePaidRun(plan, { max_cost_usd: 5, estimate_only: false })
    expect(out).toMatchObject({ proceed: true, balance_usd: 10, estimate: { total_usd: 0.02 } })
  })
})

describe('lookup cache through dataforseoRequest', () => {
  beforeEach(() => {
    resetSpend()
    vi.stubEnv('DATAFORSEO_USERNAME', 'u')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function ctx(dir: string, refresh = false): ToolContext {
    return { tool: 't', site: 'example.com', stateDir: dir, refresh, lookups: [] }
  }

  it('serves a repeat from cache at no cost, and refresh_cache bypasses it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-cache-'))
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.002, result: [{ n: 1 }] }] })),
    )
    const req = { path: 'serp/google/organic/live/advanced', task: { keyword: 'k', depth: 10 } }

    const c1 = ctx(dir)
    const first = await runWithContext(c1, () => dataforseoRequest(req))
    expect(first.cost).toBe(0.002)
    expect(c1.lookups[0]).toMatchObject({ from_cache: false, cost_usd: 0.002, params: { keyword: 'k', depth: 10 } })

    const c2 = ctx(dir)
    const second = await runWithContext(c2, () => dataforseoRequest({ ...req, task: { depth: 10, keyword: 'k' } }))
    expect(second).toEqual({ items: [{ n: 1 }], cost: 0 })
    expect(c2.lookups[0]).toMatchObject({ from_cache: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const c3 = ctx(dir, true)
    await runWithContext(c3, () => dataforseoRequest(req))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache outside a tool context (direct calls stay unchanged)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.01, result: [] }] })),
    )
    await dataforseoRequest({ path: 'x/live', task: {} })
    await dataforseoRequest({ path: 'x/live', task: {} })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('timeouts (B3)', () => {
  beforeEach(() => {
    resetSpend()
    vi.stubEnv('DATAFORSEO_USERNAME', 'u')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses 120 s for live SERP and AI endpoints, 60 s otherwise', async () => {
    const { defaultTimeoutMs } = await import('./dataforseo-client.js')
    expect(defaultTimeoutMs('serp/google/organic/live/advanced')).toBe(120_000)
    expect(defaultTimeoutMs('ai_optimization/chat_gpt/llm_scraper/live/advanced')).toBe(120_000)
    expect(defaultTimeoutMs('dataforseo_labs/google/ranked_keywords/live')).toBe(60_000)
  })

  it('records a timed-out request as a possibly billed lookup', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    const ctx: ToolContext = { tool: 'rank_tracker_run', site: 'example.com', stateDir: mkdtempSync(join(tmpdir(), 'ga4-to-')), refresh: false, lookups: [] }
    await expect(runWithContext(ctx, () => dataforseoRequest({ path: 'serp/google/organic/live/advanced', task: { keyword: 'k' } }))).rejects.toThrow(/timed out after 120 s/)
    expect(ctx.lookups).toEqual([
      expect.objectContaining({ path: 'serp/google/organic/live/advanced', cost_usd: null, from_cache: false, note: expect.stringMatching(/may still have billed/) }),
    ])
  })
})
