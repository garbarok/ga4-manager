import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ErrorCode } from '../utils/errors.js'
import { linkGapInputSchema, runLinkGap } from './link-gap.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const response = (rows: [string, number][]) => ({
  items: [{ items: rows.map(([target, rank]) => ({ domain_intersection: { '1': { target, rank, backlinks: 3 } } })) }],
  cost: 0.02,
})

describe('runLinkGap', () => {
  it('returns referring domains of the competitor, excluding ours, highest rank first', async () => {
    mockRequest.mockResolvedValueOnce(response([['blog.net', 30], ['news.org', 70]]) as never)

    const result = await runLinkGap(linkGapInputSchema.parse({ domain: 'ours.com', competitors: ['rival.com'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results).toEqual([
        { referring_domain: 'news.org', rank: 70, links_to: ['rival.com'] },
        { referring_domain: 'blog.net', rank: 30, links_to: ['rival.com'] },
      ])
      expect(result.cost_usd).toBe(0.02)
    }
    expect(mockRequest.mock.calls[0][0].task).toMatchObject({ targets: { '1': 'rival.com' }, exclude_targets: ['ours.com'], limit: 100 })
  })

  it('merges competitors and lists both in links_to', async () => {
    mockRequest
      .mockResolvedValueOnce(response([['shared.io', 50], ['only-a.io', 20]]) as never)
      .mockResolvedValueOnce(response([['www.shared.io', 50]]) as never)

    const result = await runLinkGap(linkGapInputSchema.parse({ domain: 'ours.com', competitors: ['a.com', 'b.com'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[0]).toEqual({ referring_domain: 'shared.io', rank: 50, links_to: ['a.com', 'b.com'] })
      expect(result.results[1].links_to).toEqual(['a.com'])
      expect(result.cost_usd).toBe(0.04)
    }
  })

  it('rejects our domain listed as a competitor without calling DataForSEO', async () => {
    const result = await runLinkGap(linkGapInputSchema.parse({ domain: 'ours.com', competitors: ['rival.com', 'https://www.ours.com'] }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('rejects a limit above 1000', () => {
    expect(linkGapInputSchema.safeParse({ domain: 'a.com', competitors: ['b.com'], limit: 5000 }).success).toBe(false)
  })
})
