import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { backlinksOverviewInputSchema, runBacklinksOverview } from './backlinks-overview.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const summary = (rank: number, backlinks: number, nofollow: number) => ({
  items: [{ rank, backlinks, referring_domains: 40, referring_main_domains: 35, referring_links_attributes: { nofollow } }],
  cost: 0.02,
})

describe('runBacklinksOverview', () => {
  it('returns one row per domain side by side', async () => {
    mockRequest.mockResolvedValueOnce(summary(20, 100, 25) as never).mockResolvedValueOnce(summary(45, 1000, 100) as never)

    const result = await runBacklinksOverview(backlinksOverviewInputSchema.parse({ domains: ['https://www.ours.com', 'rival.com'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { domain: 'ours.com', rank: 20, backlinks: 100, referring_domains: 40, referring_main_domains: 35, dofollow_ratio: 0.75 },
        { domain: 'rival.com', rank: 45, backlinks: 1000, referring_domains: 40, referring_main_domains: 35, dofollow_ratio: 0.9 },
      ])
      expect(result.cost_usd).toBe(0.04)
    }
    expect(mockRequest.mock.calls[0][0]).toMatchObject({ path: 'backlinks/summary/live', task: { target: 'ours.com' } })
  })

  it('keeps successful domains and marks a failed one with an error', async () => {
    mockRequest.mockResolvedValueOnce(summary(20, 100, 0) as never).mockRejectedValueOnce(new ToolError(ErrorCode.INVALID_INPUT, 'Invalid target'))

    const result = await runBacklinksOverview(backlinksOverviewInputSchema.parse({ domains: ['ours.com', 'bad'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[0].rank).toBe(20)
      expect(result.results[1]).toEqual({ domain: 'bad', error: 'Invalid target' })
    }
  })

  it('surfaces the DataForSEO error when every domain fails', async () => {
    mockRequest.mockRejectedValue(new ToolError(ErrorCode.INVALID_INPUT, 'DataForSEO task failed: Access denied.'))
    const result = await runBacklinksOverview(backlinksOverviewInputSchema.parse({ domains: ['a.com'] }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toContain('Access denied')
  })

  it('rejects more than 5 domains', () => {
    expect(backlinksOverviewInputSchema.safeParse({ domains: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false)
  })
})
