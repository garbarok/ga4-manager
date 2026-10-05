import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoPost } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { keywordSerpSnapshotInputSchema, runKeywordSerpSnapshot } from './keyword-serp.js'

vi.mock('../utils/dataforseo-client.js', () => ({
  dataforseoPost: vi.fn(),
}))

const mockPost = vi.mocked(dataforseoPost)

beforeEach(() => {
  mockPost.mockReset()
})

describe('keywordSerpSnapshotInputSchema', () => {
  it('applies defaults', () => {
    const parsed = keywordSerpSnapshotInputSchema.parse({ keyword: 'best crm' })
    expect(parsed.location_name).toBe('United States')
    expect(parsed.language_code).toBe('en')
    expect(parsed.depth).toBe(10)
  })

  it('rejects depth above 100', () => {
    const r = keywordSerpSnapshotInputSchema.safeParse({ keyword: 'x', depth: 101 })
    expect(r.success).toBe(false)
  })
})

describe('runKeywordSerpSnapshot', () => {
  it('filters to organic items and maps them, respecting depth', async () => {
    mockPost.mockResolvedValueOnce([
      {
        keyword: 'best crm',
        items: [
          { type: 'organic', rank_absolute: 1, url: 'https://a.com/', domain: 'a.com', title: 'A', description: 'desc a' },
          { type: 'featured_snippet', rank_absolute: 0, url: 'https://snippet.com/' },
          { type: 'organic', rank_absolute: 2, url: 'https://b.com/', domain: 'b.com', title: 'B', description: 'desc b' },
        ],
      },
    ] as never)

    const result = await runKeywordSerpSnapshot(keywordSerpSnapshotInputSchema.parse({ keyword: 'best crm', depth: 5 }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { position: 1, url: 'https://a.com/', domain: 'a.com', title: 'A', description: 'desc a' },
        { position: 2, url: 'https://b.com/', domain: 'b.com', title: 'B', description: 'desc b' },
      ])
    }
  })

  it('returns NOT_FOUND when DataForSEO returns no result', async () => {
    mockPost.mockResolvedValueOnce([] as never)
    const result = await runKeywordSerpSnapshot(keywordSerpSnapshotInputSchema.parse({ keyword: 'x' }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('converts a thrown ToolError into a failure result', async () => {
    mockPost.mockRejectedValueOnce(new ToolError(ErrorCode.INVALID_INPUT, 'bad keyword'))
    const result = await runKeywordSerpSnapshot(keywordSerpSnapshotInputSchema.parse({ keyword: 'x' }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
  })
})
