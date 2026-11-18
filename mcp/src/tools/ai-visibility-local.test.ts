import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  promptsGenerateInputSchema,
  runPromptsGenerate,
  trackerSaveInputSchema,
  runTrackerSave,
  resultsInputSchema,
  runResults,
  trendInputSchema,
  runTrend,
  sourcesInputSchema,
  runSources,
  answerInputSchema,
  runAnswer,
  exportInputSchema,
  runExport,
} from './ai-visibility-local.js'
import { StateStore } from '../utils/state-store.js'
import { emptyContext, saveContext } from '../utils/project-context-store.js'
import { saveRun, summarize, toCsv, exportRows, type Run } from './ai-visibility/store.js'
import { analyzeAnswer } from './ai-visibility/detect.js'
import { generatePrompts } from './ai-visibility/generate.js'
import type { AnswerRecord, ModelId } from './ai-visibility/models.js'

const SITE = 'toolb.example.com'
const COMP = [{ domain: 'toola.example.com', name: 'ToolA' }]
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ga4-aivis-local-'))
})

function answer(prompt: string, model: ModelId, text: string, domains: string[]): AnswerRecord {
  return {
    model,
    model_version: null,
    prompt,
    available: true,
    answer_text: text,
    sources: domains.map((d) => ({ url: `https://${d}/page`, domain: d })),
    fetched_at: '2026-01-01T00:00:00.000Z',
    cost_usd: 0.004,
  }
}

function storeRun(id: string, startedAt: string, answers: AnswerRecord[]): Run {
  const results = answers.map((a) => analyzeAnswer(a, { site: SITE, terms: ['ToolB'] }, COMP))
  return saveRun(new StateStore(dir), {
    id,
    site: SITE,
    tracker_id: 'default',
    started_at: startedAt,
    finished_at: startedAt,
    models: [...new Set(answers.map((a) => a.model))],
    location_code: 2840,
    language_code: 'en',
    brand_terms: ['ToolB'],
    competitors: COMP,
    prompt_count: new Set(answers.map((a) => a.prompt)).size,
    cost_usd: 0.008,
    summary: summarize(results, SITE, COMP),
    results,
    answers,
  })
}

function twoRuns() {
  storeRun('20260101T000000Z-aaaaaa', '2026-01-01T00:00:00.000Z', [
    answer('best analytics tools', 'chatgpt', 'ToolA is best.', ['toola.example.com', 'reviews.example.net']),
    answer('toolb reviews', 'chatgpt', 'ToolB is fine.', ['reviews.example.net']),
  ])
  storeRun('20260201T000000Z-bbbbbb', '2026-02-01T00:00:00.000Z', [
    answer('best analytics tools', 'chatgpt', 'ToolB and ToolA, see "quotes", too.', ['toolb.example.com', 'reviews.example.net']),
    answer('toolb reviews', 'chatgpt', 'ToolB is great.', ['toolb.example.com']),
  ])
}

describe('ai_visibility_prompts_generate', () => {
  it('builds category, brand and competitor prompts from project context', () => {
    const store = new StateStore(dir)
    saveContext(store, {
      ...emptyContext(SITE),
      brand_name: 'ToolB',
      competitors: COMP,
      key_pages: [{ url: 'https://toolb.example.com/', role: 'money', topic: 'web analytics' }],
    })
    const out = runPromptsGenerate(promptsGenerateInputSchema.parse({ site: SITE, state_dir: dir, audience: 'small businesses' }))
    expect(out.prompts.map((p) => p.text)).toEqual([
      'what are the best web analytics tools',
      'what is the best web analytics',
      'what is the best web analytics for small businesses',
      'how do I choose a web analytics',
      'ToolB reviews',
      'is ToolB good',
      'what is ToolB',
      'ToolB vs ToolA',
      'alternatives to ToolA',
    ])
    expect(out.warnings).toEqual([])
  })

  it('warns without project context and dedupes / caps output', () => {
    const out = runPromptsGenerate(promptsGenerateInputSchema.parse({ site: SITE, state_dir: dir, topics: ['crm', 'CRM'], max: 3 }))
    expect(out.prompts).toHaveLength(3)
    expect(out.warnings[0]).toMatch(/No project context/)
    expect(generatePrompts({ topics: [], competitors: [], max: 10 })).toEqual([])
  })
})

describe('ai_visibility_tracker_save', () => {
  it('creates, patches and dedupes the prompt set; competitors default from project context', () => {
    saveContext(new StateStore(dir), { ...emptyContext(SITE), brand_name: 'ToolB', competitors: [{ domain: 'https://www.toola.example.com/' }] })
    const created = runTrackerSave(trackerSaveInputSchema.parse({ site: SITE, state_dir: dir, prompts: ['a prompt', { text: 'b prompt', tags: ['x'] }, 'A prompt'] }))
    expect(created).toMatchObject({
      success: true,
      tracker: { prompts: [{ text: 'a prompt', tags: [] }, { text: 'b prompt', tags: ['x'] }], brand_terms: ['ToolB'], competitors: [{ domain: 'toola.example.com' }], models: ['chatgpt', 'google_ai_overview', 'google_ai_mode'] },
      requests_per_run: 6,
    })
    const patched = runTrackerSave(trackerSaveInputSchema.parse({ site: SITE, state_dir: dir, add_prompts: ['c prompt'], remove_prompts: ['A PROMPT'], models: ['claude'] }))
    expect(patched).toMatchObject({ tracker: { prompts: [{ text: 'b prompt' }, { text: 'c prompt' }], models: ['claude'] } })
  })

  it('rejects an empty prompt set', () => {
    expect(runTrackerSave(trackerSaveInputSchema.parse({ site: SITE, state_dir: dir }))).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })
})

describe('reads over stored runs', () => {
  it('results: newest run by default, with filters', () => {
    twoRuns()
    const out = runResults(resultsInputSchema.parse({ site: SITE, state_dir: dir }))
    expect(out.run_id).toBe('20260201T000000Z-bbbbbb')
    expect(out.results).toHaveLength(2)
    const missing = runResults(resultsInputSchema.parse({ site: SITE, state_dir: dir, run_id: '20260101T000000Z-aaaaaa', only: 'not_mentioned' }))
    expect(missing.results.map((r) => r.prompt)).toEqual(['best analytics tools'])
  })

  it('results: NOT_FOUND before any run (via the thrown ToolError)', () => {
    expect(() => runResults(resultsInputSchema.parse({ site: SITE, state_dir: dir }))).toThrow(/No AI-visibility runs/)
  })

  it('trend: oldest to newest with change', () => {
    twoRuns()
    const out = runTrend(trendInputSchema.parse({ site: SITE, state_dir: dir })) as { success: true; trend: { model: string; points: { mention_rate: number }[]; change: { mention_rate: number; citation_rate: number } }[] }
    expect(out.trend[0].points.map((p) => p.mention_rate)).toEqual([0.5, 1])
    expect(out.trend[0].change).toEqual({ mention_rate: 0.5, citation_rate: 1 })
  })

  it('sources: all runs, flags own and competitor domains', () => {
    twoRuns()
    const out = runSources(sourcesInputSchema.parse({ site: SITE, state_dir: dir, scope: 'all' })) as { sources: { key: string; citations: number; is_own: boolean; competitor: string | null }[]; own_citations: number }
    expect(out.sources[0]).toMatchObject({ key: 'reviews.example.net', citations: 3, is_own: false, competitor: null })
    expect(out.sources.find((s) => s.key === 'toola.example.com')).toMatchObject({ competitor: 'toola.example.com' })
    expect(out.own_citations).toBe(2)
  })

  it('answer: by text or 1-based index', () => {
    twoRuns()
    const byText = runAnswer(answerInputSchema.parse({ site: SITE, state_dir: dir, prompt: 'TOOLB REVIEWS', model: 'chatgpt' }))
    expect(byText).toMatchObject({ success: true, answer: { answer_text: 'ToolB is great.' }, analysis: { mentioned: true, cited: true } })
    const byIndex = runAnswer(answerInputSchema.parse({ site: SITE, state_dir: dir, prompt: '1', model: 'chatgpt' }))
    expect(byIndex).toMatchObject({ answer: { prompt: 'best analytics tools' } })
    expect(runAnswer(answerInputSchema.parse({ site: SITE, state_dir: dir, prompt: 'nope', model: 'claude' }))).toMatchObject({ success: false })
  })

  it('export: CSV quoting and file written under the state dir', () => {
    twoRuns()
    const out = runExport(exportInputSchema.parse({ site: SITE, state_dir: dir, scope: 'all', write: true })) as { rows: number; path: string; content: string }
    expect(out.rows).toBe(4)
    expect(out.path).toBe(join(dir, 'exports', SITE, 'ai-visibility-all.csv'))
    expect(readFileSync(out.path, 'utf8')).toBe(out.content)
    expect(out.content.split('\n')[0]).toBe('run_id,date,model,prompt,available,mentioned,mention_rank,cited,cited_urls,competitors_mentioned,competitors_cited,source_count,sources,error')
    const json = runExport(exportInputSchema.parse({ site: SITE, state_dir: dir, format: 'json' })) as { content: string }
    expect(JSON.parse(json.content)).toHaveLength(2)
  })

  it('toCsv escapes commas and quotes', () => {
    const csv = toCsv([{ run_id: 'r', prompt: 'a, "b"' }])
    expect(csv.split('\n')[1]).toContain('"a, ""b"""')
    expect(exportRows([])).toEqual([])
  })
})

describe('prompt language (B5)', () => {
  it('writes Spanish, German and French prompts, and warns on an unsupported language', async () => {
    const { generatePrompts, templateLanguage } = await import('./ai-visibility/generate.js')
    const es = generatePrompts({ topics: ['mantenimiento moto'], brand: 'Example', competitors: [{ domain: 'rival.example', name: 'Rival' }], max: 20, language: 'es-ES' })
    expect(es.map((p) => p.text)).toEqual([
      '¿cuáles son las mejores apps para mantenimiento moto?',
      '¿cuál es la mejor app de mantenimiento moto?',
      '¿cómo elegir una app de mantenimiento moto?',
      'opiniones de Example',
      '¿Example es buena?',
      '¿qué es Example?',
      'Example vs Rival',
      'alternativas a Rival',
    ])
    expect(generatePrompts({ topics: ['Kette spannen'], competitors: [], max: 1, language: 'de' })[0].text).toBe('Was sind die besten Apps für Kette spannen?')
    expect(generatePrompts({ topics: ['entretien moto'], competitors: [], max: 1, language: 'fr' })[0].text).toBe('quelles sont les meilleures applications pour entretien moto ?')
    expect(templateLanguage('it')).toBeNull()
    expect(generatePrompts({ topics: ['x y'], competitors: [], max: 1, language: 'it' })[0].text).toBe('what are the best x y tools')
  })
})
