import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MODELS, MODEL_IDS, cleanUrl, normalizeAiOverview, normalizeLlmResponse, normalizeScraper } from './models.js'

export function fixture(name: string): { tasks: { cost: number; result: unknown[] }[] } {
  return JSON.parse(readFileSync(new URL(`../__fixtures__/ai-visibility/${name}.json`, import.meta.url), 'utf8'))
}
const result = (name: string) => fixture(name).tasks[0].result[0]

describe('normalizeScraper (ChatGPT / Gemini web UI)', () => {
  it('takes markdown as the answer and dedupes cleaned source URLs', () => {
    const a = normalizeScraper(result('chatgpt-scraper'))
    expect(a.available).toBe(true)
    expect(a.model_version).toBe('gpt-6')
    expect(a.answer_text).toContain('**ToolB** is lightweight')
    expect(a.sources).toEqual([
      { url: 'https://toola.example.com/', domain: 'toola.example.com', title: 'ToolA' },
      { url: 'https://github.com/example/toolb', domain: 'github.com', title: 'GitHub' },
      { url: 'https://reviews.example.net/best-analytics', domain: 'reviews.example.net', title: 'Review' },
    ])
  })
  it('reads Gemini sources the same way', () => {
    const a = normalizeScraper(result('gemini-scraper'))
    expect(a.sources.map((s) => s.domain)).toEqual(['toolc.example.org', 'en.wikipedia.org'])
  })
})

describe('normalizeAiOverview (AI Mode / AI Overview)', () => {
  it('reads references and links of the ai_overview item', () => {
    const a = normalizeAiOverview(result('google-ai-mode'))
    expect(a.answer_text).toBe('Popular choices are **ToolB** and **ToolA**.')
    expect(a.sources.map((s) => s.domain)).toEqual(['toolb.example.com', 'reviews.example.net', 'toola.example.com'])
  })
  it('resolves google.com/goto references to the named site, or null when only a name is given', () => {
    const a = normalizeAiOverview(result('google-ai-overview'))
    expect(a.sources).toEqual([
      { url: 'https://google.com/goto?url=CAESabc', domain: 'reviews.example.net', title: 'Top analytics tools' },
      { url: 'https://google.com/goto?url=CAESdef', domain: null, title: 'Top 14 tools' },
      { url: 'https://toolc.example.org/', domain: 'toolc.example.org', title: 'ToolC' },
    ])
  })
  it('marks a SERP without an AI Overview as unavailable', () => {
    expect(normalizeAiOverview(result('google-no-ai-overview'))).toEqual({ model_version: null, available: false, answer_text: '', sources: [] })
  })
})

describe('normalizeLlmResponse (model APIs)', () => {
  it('joins message sections, skips reasoning, and uses annotations as citations', () => {
    const claude = normalizeLlmResponse(result('claude-llm-responses'))
    expect(claude.model_version).toBe('claude-haiku-5-5')
    expect(claude.answer_text).toBe('Here are good options.\n\nToolC is the most complete; ToolA and toolb.example.com are lighter.')
    expect(claude.sources.map((s) => s.domain)).toEqual(['toolc.example.org', 'toolb.example.com'])

    const gpt = normalizeLlmResponse(result('chatgpt-llm-responses'))
    expect(gpt.answer_text).toBe('Consider ToolA or ToolC.')
    expect(gpt.sources).toEqual([{ url: 'https://toola.example.com/', domain: 'toola.example.com', title: 'ToolA' }])
  })
  it('falls back to search_results when the answer has no annotations', () => {
    const a = normalizeLlmResponse(result('gemini-llm-responses'))
    expect(a.sources).toEqual([{ url: 'https://reviews.example.net/toolb', domain: 'reviews.example.net', title: 'ToolB review' }])
  })
})

describe('model table', () => {
  it('builds the task each endpoint expects', () => {
    const o = { location_code: 2840, language_code: 'en' }
    expect(MODELS.chatgpt.buildTask('q', o)).toEqual({ keyword: 'q', location_code: 2840, language_code: 'en' })
    expect(MODELS.google_ai_overview.buildTask('q', o)).toMatchObject({ depth: 10, load_async_ai_overview: true })
    expect(MODELS.claude.buildTask('q', o)).toEqual({ user_prompt: 'q', model_name: 'claude-haiku-5-5', web_search: true })
    for (const id of MODEL_IDS) expect(MODELS[id].id).toBe(id)
  })
  it('cleanUrl drops tracking parameters only', () => {
    expect(cleanUrl('https://a.example.com/x?utm_source=chatgpt.com&id=2')).toBe('https://a.example.com/x?id=2')
    expect(cleanUrl('not a url')).toBe('not a url')
  })
})
