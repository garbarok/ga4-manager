import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { rankedKeywordsInputSchema, runRankedKeywords } from './ranked-keywords.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const item = (keyword: string, position: number) => ({
  keyword_data: { keyword, keyword_info: { search_volume: 1000 } },
  ranked_serp_element: { serp_item: { rank_group: position, url: `https://rival.com/${keyword}`, etv: 42.5 } },
})

describe('rankedKeywordsInputSchema', () => {
  it('defaults limit to 100 and rejects 5000', () => {
    expect(rankedKeywordsInputSchema.parse({ domain: 'a.com' }).limit).toBe(100)
    expect(rankedKeywordsInputSchema.safeParse({ domain: 'a.com', limit: 5000 }).success).toBe(false)
  })
})

describe('runRankedKeywords', () => {
  it('maps rows with position, url, volume, etv and total_count', async () => {
    mockRequest.mockResolvedValueOnce({ items: [{ total_count: 1234, items: [item('calc', 4)] }], cost: 0.0101 } as never)

    const result = await runRankedKeywords(rankedKeywordsInputSchema.parse({ domain: 'https://www.rival.com' }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.total_count).toBe(1234)
      expect(result.results).toEqual([{ keyword: 'calc', position: 4, url: 'https://rival.com/calc', search_volume: 1000, etv: 42.5 }])
      expect(result.cost_usd).toBe(0.0101)
    }
    expect(mockRequest.mock.calls[0][0].task).toMatchObject({ target: 'rival.com', limit: 100 })
  })

  it('applies max_position server-side and client-side', async () => {
    mockRequest.mockResolvedValueOnce({ items: [{ total_count: 2, items: [item('top', 3), item('deep', 25)] }], cost: 0.01 } as never)

    const result = await runRankedKeywords(rankedKeywordsInputSchema.parse({ domain: 'rival.com', max_position: 10 }))

    expect(result.success).toBe(true)
    if (result.success) expect(result.results.map((r) => r.keyword)).toEqual(['top'])
    expect(mockRequest.mock.calls[0][0].task?.filters).toEqual([['ranked_serp_element.serp_item.rank_group', '<=', 10]])
  })
})
