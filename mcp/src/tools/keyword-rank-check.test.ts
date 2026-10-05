import { describe, it, expect, vi, beforeEach } from 'vitest'
import { valueSerpSearch } from '../utils/valueserp-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { keywordRankCheckInputSchema, runKeywordRankCheck } from './keyword-rank-check.js'

vi.mock('../utils/valueserp-client.js', () => ({
  valueSerpSearch: vi.fn(),
}))

const mockSearch = vi.mocked(valueSerpSearch)

beforeEach(() => {
  mockSearch.mockReset()
})

describe('keywordRankCheckInputSchema', () => {
  it('applies defaults', () => {
    const parsed = keywordRankCheckInputSchema.parse({ keyword: 'crm software', domain: 'example.com' })
    expect(parsed.location).toBe('United States')
    expect(parsed.google_domain).toBe('google.com')
    expect(parsed.num).toBe(100)
  })
})

const RESULTS = [
  { position: 1, title: 'Competitor', link: 'https://competitor.com/crm' },
  { position: 2, title: 'Mine', link: 'https://www.example.com/crm-software' },
  { position: 3, title: 'Other', link: 'https://other.com/' },
]

function searchResult(organic: typeof RESULTS, aiOverviewPresent = false, aiOverviewSources: unknown[] = []) {
  return { organic, aiOverviewPresent, aiOverviewSources } as never
}

describe('runKeywordRankCheck', () => {
  it('finds the matching domain (www.-insensitive) and reports its position', async () => {
    mockSearch.mockResolvedValueOnce(searchResult(RESULTS))

    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'crm software', domain: 'example.com' }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result.position).toBe(2)
      expect(result.result.matched_url).toBe('https://www.example.com/crm-software')
      expect(result.result.top_results).toHaveLength(3)
      expect(result.result.ai_overview).toEqual({
        present: false,
        checked: false,
        cited: false,
        matched_url: null,
        sources: [],
      })
    }
    expect(mockSearch).toHaveBeenCalledTimes(1) // no AI Overview fallback needed — organic already matched
  })

  it('returns position null when the domain is not found and there is no AI Overview', async () => {
    mockSearch.mockResolvedValueOnce(searchResult(RESULTS))

    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'crm software', domain: 'nowhere.com' }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result.position).toBeNull()
      expect(result.result.matched_url).toBeNull()
      expect(result.result.ai_overview.present).toBe(false)
    }
    expect(mockSearch).toHaveBeenCalledTimes(1)
  })

  it('matches subdomains of the target domain', async () => {
    mockSearch.mockResolvedValueOnce(searchResult([{ position: 5, title: 'Blog', link: 'https://blog.example.com/post' }]))

    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'x', domain: 'example.com' }),
    )

    expect(result.success).toBe(true)
    if (result.success) expect(result.result.position).toBe(5)
  })

  it('falls back to checking AI Overview sources when organic misses and check_ai_overview is true', async () => {
    mockSearch
      .mockResolvedValueOnce(searchResult(RESULTS, true))
      .mockResolvedValueOnce(
        searchResult([], true, [{ url: 'https://www.nowhere.com/guide', domain: 'nowhere.com', title: 'Guide' }]),
      )

    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'crm software', domain: 'nowhere.com' }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result.position).toBeNull() // still not in organic
      expect(result.result.ai_overview).toEqual({
        present: true,
        checked: true,
        cited: true,
        matched_url: 'https://www.nowhere.com/guide',
        sources: [{ url: 'https://www.nowhere.com/guide', domain: 'nowhere.com', title: 'Guide' }],
      })
    }
    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(mockSearch.mock.calls[1][0]).toMatchObject({ include_ai_overview: true })
  })

  it('skips the AI Overview fallback when check_ai_overview is false', async () => {
    mockSearch.mockResolvedValueOnce(searchResult(RESULTS, true))

    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'crm software', domain: 'nowhere.com', check_ai_overview: false }),
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.result.ai_overview).toEqual({ present: true, checked: false, cited: false, matched_url: null, sources: [] })
    }
    expect(mockSearch).toHaveBeenCalledTimes(1)
  })

  it('converts a thrown ToolError into a failure result', async () => {
    mockSearch.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'no key'))
    const result = await runKeywordRankCheck(
      keywordRankCheckInputSchema.parse({ keyword: 'x', domain: 'example.com' }),
    )
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.AUTH_DENIED)
  })
})
