import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ErrorCode } from '../utils/errors.js'
import { keywordGapInputSchema, runKeywordGap } from './keyword-gap.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const item = (keyword: string, volume: number | null, ours = false) => ({
  keyword_data: { keyword, keyword_info: { search_volume: volume }, keyword_properties: { keyword_difficulty: 12 } },
  first_domain_serp_element: { rank_group: 3, url: `https://rival.com/${keyword}` },
  second_domain_serp_element: ours ? { rank_group: 8, url: 'https://ours.com/' } : null,
})

describe('keywordGapInputSchema', () => {
  it('defaults limit to 100 and rejects 5000', () => {
    expect(keywordGapInputSchema.parse({ domain: 'a.com', competitor: 'b.com' }).limit).toBe(100)
    expect(keywordGapInputSchema.safeParse({ domain: 'a.com', competitor: 'b.com', limit: 5000 }).success).toBe(false)
  })
})

describe('runKeywordGap', () => {
  it('returns only keywords the competitor ranks for and we do not, sorted by volume', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ total_count: 3, items: [item('small', 10), item('big', 900), item('shared', 5000, true)] }],
      cost: 0.0103,
    } as never)

    const result = await runKeywordGap(keywordGapInputSchema.parse({ domain: 'ours.com', competitor: 'https://www.rival.com' }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results.map((r) => r.keyword)).toEqual(['big', 'small'])
      expect(result.results[0]).toEqual({
        keyword: 'big',
        search_volume: 900,
        keyword_difficulty: 12,
        competitor_position: 3,
        competitor_url: 'https://rival.com/big',
      })
      expect(result.cost_usd).toBe(0.0103)
    }
    expect(mockRequest.mock.calls[0][0].task).toMatchObject({ target1: 'rival.com', target2: 'ours.com', intersections: false, limit: 100 })
  })

  it('applies the volume filter server-side and client-side', async () => {
    mockRequest.mockResolvedValueOnce({ items: [{ items: [item('low', 50), item('high', 500)] }], cost: 0.01 } as never)

    const result = await runKeywordGap(keywordGapInputSchema.parse({ domain: 'ours.com', competitor: 'rival.com', min_search_volume: 100 }))

    expect(result.success).toBe(true)
    if (result.success) expect(result.results.map((r) => r.keyword)).toEqual(['high'])
    expect(mockRequest.mock.calls[0][0].task?.filters).toEqual([['keyword_data.keyword_info.search_volume', '>=', 100]])
  })

  it('rejects the same domain twice without calling DataForSEO', async () => {
    const result = await runKeywordGap(keywordGapInputSchema.parse({ domain: 'ours.com', competitor: 'https://www.ours.com/' }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
