import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoPost } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { keywordVolumeInputSchema, runKeywordVolume } from './keyword-volume.js'

vi.mock('../utils/dataforseo-client.js', () => ({
  dataforseoPost: vi.fn(),
}))

const mockPost = vi.mocked(dataforseoPost)

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
    mockPost.mockResolvedValueOnce([
      { keyword: 'seo tool', search_volume: 1000, cpc: 2.5, competition: 'HIGH', competition_index: 80 },
    ] as never)

    const result = await runKeywordVolume(keywordVolumeInputSchema.parse({ keywords: ['seo tool'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { keyword: 'seo tool', search_volume: 1000, cpc: 2.5, competition: 'HIGH', competition_index: 80 },
      ])
    }
    expect(mockPost).toHaveBeenCalledWith('keywords_data/google_ads/search_volume/live', {
      keywords: ['seo tool'],
      location_name: 'United States',
      language_code: 'en',
    })
  })

  it('returns NOT_FOUND when DataForSEO returns no rows', async () => {
    mockPost.mockResolvedValueOnce([] as never)
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
