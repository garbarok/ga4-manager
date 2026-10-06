import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { keywordVolumeInputSchema, runKeywordVolume } from './keyword-volume.js'

vi.mock('../utils/dataforseo-client.js', () => ({
  dataforseoRequest: vi.fn(),
}))

const mockPost = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockPost.mockReset()
})

describe('keywordVolumeInputSchema', () => {
  it('applies location/language defaults', () => {
    const parsed = keywordVolumeInputSchema.parse({ keywords: ['seo tool'] })
    expect(parsed.location_name).toBe('United States')
    expect(parsed.language_code).toBe('en')
  })

  it('rejects an empty keywords array', () => {
    const r = keywordVolumeInputSchema.safeParse({ keywords: [] })
    expect(r.success).toBe(false)
  })

  it('rejects more than 200 keywords', () => {
    const r = keywordVolumeInputSchema.safeParse({ keywords: Array.from({ length: 201 }, (_, i) => `k${i}`) })
    expect(r.success).toBe(false)
  })
})

describe('runKeywordVolume', () => {
  it('maps DataForSEO rows into the output shape', async () => {
    mockPost.mockResolvedValueOnce({ items: [
      { keyword: 'seo tool', search_volume: 1000, cpc: 2.5, competition: 'HIGH', competition_index: 80 },
    ], cost: 0.075 } as never)

    const result = await runKeywordVolume(keywordVolumeInputSchema.parse({ keywords: ['seo tool'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { keyword: 'seo tool', search_volume: 1000, cpc: 2.5, competition: 'HIGH', competition_index: 80 },
      ])
    }
    if (result.success) expect(result.cost_usd).toBe(0.075)
    expect(mockPost).toHaveBeenCalledWith({
      path: 'keywords_data/google_ads/search_volume/live',
      task: { keywords: ['seo tool'], location_name: 'United States', language_code: 'en' },
    })
  })

  it('returns NOT_FOUND when DataForSEO returns no rows', async () => {
    mockPost.mockResolvedValueOnce({ items: [], cost: 0.01 } as never)
    const result = await runKeywordVolume(keywordVolumeInputSchema.parse({ keywords: ['nonsense'] }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('converts a thrown ToolError into a failure result', async () => {
    mockPost.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'no creds'))
    const result = await runKeywordVolume(keywordVolumeInputSchema.parse({ keywords: ['x'] }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.AUTH_DENIED)
  })
})
