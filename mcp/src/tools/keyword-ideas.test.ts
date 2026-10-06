import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { keywordIdeasInputSchema, runKeywordIdeas } from './keyword-ideas.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

describe('keywordIdeasInputSchema', () => {
  it('defaults limit to 100 and rejects 5000', () => {
    expect(keywordIdeasInputSchema.parse({ keywords: ['x'] }).limit).toBe(100)
    expect(keywordIdeasInputSchema.safeParse({ keywords: ['x'], limit: 5000 }).success).toBe(false)
  })
})

describe('runKeywordIdeas', () => {
  it('maps volume, cpc, difficulty and intent, keeping nulls when unknown', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [
        {
          total_count: 2,
          items: [
            {
              keyword: 'sp500 return calculator',
              keyword_info: { search_volume: 2400, cpc: 1.2 },
              keyword_properties: { keyword_difficulty: 18 },
              search_intent_info: { main_intent: 'informational' },
            },
            { keyword: 'obscure idea' },
          ],
        },
      ],
      cost: 0.0102,
    } as never)

    const result = await runKeywordIdeas(keywordIdeasInputSchema.parse({ keywords: ['s&p 500 calculator'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { keyword: 'sp500 return calculator', search_volume: 2400, cpc: 1.2, keyword_difficulty: 18, search_intent: 'informational' },
        { keyword: 'obscure idea', search_volume: null, cpc: null, keyword_difficulty: null, search_intent: null },
      ])
      expect(result.cost_usd).toBe(0.0102)
    }
  })

  it('drops ideas above max_keyword_difficulty', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ items: [{ keyword: 'easy', keyword_properties: { keyword_difficulty: 10 } }, { keyword: 'hard', keyword_properties: { keyword_difficulty: 70 } }] }],
      cost: 0.01,
    } as never)

    const result = await runKeywordIdeas(keywordIdeasInputSchema.parse({ keywords: ['x'], max_keyword_difficulty: 30 }))

    expect(result.success).toBe(true)
    if (result.success) expect(result.results.map((r) => r.keyword)).toEqual(['easy'])
    expect(mockRequest.mock.calls[0][0].task?.filters).toEqual([['keyword_properties.keyword_difficulty', '<=', 30]])
  })
})
