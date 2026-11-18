import { describe, it, expect } from 'vitest'
import { analyzeAnswer, firstOccurrence, domainMatches, summarize } from './detect.js'
import type { AnswerRecord } from './models.js'

function answer(text: string, domains: string[], extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    model: 'chatgpt',
    model_version: null,
    prompt: 'p',
    available: true,
    answer_text: text,
    sources: domains.map((d) => ({ url: `https://${d}/`, domain: d })),
    fetched_at: '2026-01-01T00:00:00.000Z',
    cost_usd: 0.004,
    ...extra,
  }
}

const BRAND = { site: 'toolb.example.com', terms: ['ToolB'] }
const COMP = [
  { domain: 'toola.example.com', name: 'ToolA' },
  { domain: 'toolc.example.org', name: 'ToolC' },
]

describe('firstOccurrence', () => {
  it('matches whole words, case-insensitively', () => {
    expect(firstOccurrence('We like toolb a lot', ['ToolB'])).toBe(8)
    expect(firstOccurrence('ToolBox is different', ['ToolB'])).toBe(-1)
    expect(firstOccurrence('see toolb.example.com.', ['toolb.example.com'])).toBe(4)
    expect(firstOccurrence('ÁToolB', ['ToolB'])).toBe(-1)
  })
})

describe('domainMatches', () => {
  it('accepts www and subdomains, rejects lookalikes', () => {
    expect(domainMatches('www.example.com', 'example.com')).toBe(true)
    expect(domainMatches('blog.example.com', 'example.com')).toBe(true)
    expect(domainMatches('notexample.com', 'example.com')).toBe(false)
    expect(domainMatches(null, 'example.com')).toBe(false)
  })
})

describe('analyzeAnswer', () => {
  it('ranks the brand among competitors by first mention', () => {
    const r = analyzeAnswer(answer('ToolA first, then ToolC, then ToolB.', ['toolb.example.com', 'toola.example.com']), BRAND, COMP)
    expect(r).toMatchObject({ mentioned: true, mention_rank: 3, cited: true, cited_urls: ['https://toolb.example.com/'], source_count: 2 })
    expect(r.competitors).toEqual([
      { domain: 'toola.example.com', name: 'ToolA', mentioned: true, cited: true },
      { domain: 'toolc.example.org', name: 'ToolC', mentioned: true, cited: false },
    ])
  })

  it('counts the site domain in the text as a mention even without brand terms', () => {
    const r = analyzeAnswer(answer('Visit toolb.example.com for more.', []), { site: 'toolb.example.com', terms: [] }, [])
    expect(r).toMatchObject({ mentioned: true, mention_rank: 1, cited: false })
  })

  it('reports not mentioned with null rank and offset', () => {
    const r = analyzeAnswer(answer('Only ToolA here.', []), BRAND, COMP)
    expect(r).toMatchObject({ mentioned: false, mention_rank: null, first_mention_offset: null })
  })
})

describe('summarize', () => {
  it('computes rates over answered cells and share of voice', () => {
    const rows = [
      analyzeAnswer(answer('ToolB and ToolA', ['toolb.example.com']), BRAND, COMP),
      analyzeAnswer(answer('ToolA only', []), BRAND, COMP),
      analyzeAnswer(answer('', [], { available: false }), BRAND, COMP),
      analyzeAnswer(answer('', [], { available: false, error: 'boom' }), BRAND, COMP),
    ]
    const [s] = summarize(rows, 'toolb.example.com', COMP)
    expect(s).toMatchObject({ model: 'chatgpt', answers: 4, answered: 2, mentioned: 1, cited: 1, mention_rate: 0.5, citation_rate: 0.5, avg_mention_rank: 1 })
    expect(s.share_of_voice).toEqual([
      { entity: 'toolb.example.com', is_brand: true, mentions: 1, share: 0.333 },
      { entity: 'toola.example.com', is_brand: false, mentions: 2, share: 0.667 },
      { entity: 'toolc.example.org', is_brand: false, mentions: 0, share: 0 },
    ])
  })
})
