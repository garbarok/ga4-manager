import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ErrorCode } from '../utils/errors.js'
import { googleTrendsInputSchema, runGoogleTrends, summarizeTrend } from './google-trends.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const point = (date: string, values: number[], missing = false) => ({ date_from: date, date_to: date, missing_data: missing, values })

const graphResponse = {
  items: [
    {
      items: [
        {
          type: 'google_trends_graph',
          keywords: ['coast fire calculator', 'fire calculator'],
          data: [
            point('2025-10-05', [10, 40]),
            point('2025-10-12', [20, 50]),
            point('2025-10-19', [30, 100]),
            point('2025-10-26', [40, 60]),
          ],
          averages: [25, 62],
        },
      ],
    },
  ],
  cost: 0.011,
}

describe('googleTrendsInputSchema', () => {
  it('applies defaults', () => {
    const p = googleTrendsInputSchema.parse({ keywords: ['x'] })
    expect(p).toMatchObject({ time_range: 'past_12_months', type: 'web', location_name: 'United States', include_series: true })
  })

  it('rejects more than 5 keywords', () => {
    expect(googleTrendsInputSchema.safeParse({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false)
  })

  it('rejects date_to without date_from', () => {
    expect(googleTrendsInputSchema.safeParse({ keywords: ['a'], date_to: '2026-01-01' }).success).toBe(false)
  })
})

describe('summarizeTrend', () => {
  it('computes latest, peak and last-vs-first-quarter change', () => {
    const series = graphResponse.items[0].items[0].data.map((p) => ({ date_from: p.date_from, date_to: p.date_to, values: p.values }))
    expect(summarizeTrend('fire calculator', 1, series, 62)).toEqual({
      keyword: 'fire calculator',
      average: 62,
      latest: 60,
      peak: 100,
      peak_date: '2025-10-19',
      change_pct: 50,
    })
  })

  it('returns nulls when there is no data', () => {
    expect(summarizeTrend('x', 0, [], undefined)).toMatchObject({ average: null, peak: null, change_pct: null })
  })
})

describe('runGoogleTrends', () => {
  it('returns summary, series and cost', async () => {
    mockRequest.mockResolvedValueOnce(graphResponse as never)

    const result = await runGoogleTrends(googleTrendsInputSchema.parse({ keywords: ['coast fire calculator', 'fire calculator'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.summary.map((s) => s.change_pct)).toEqual([300, 50])
      expect(result.series?.[0]).toEqual({ date_from: '2025-10-05', date_to: '2025-10-05', values: [10, 40] })
      expect(result.cost_usd).toBe(0.011)
    }
    expect(mockRequest.mock.calls[0][0].task).toMatchObject({ time_range: 'past_12_months', type: 'web' })
  })

  it('sends a custom date range instead of time_range and can omit the series', async () => {
    mockRequest.mockResolvedValueOnce(graphResponse as never)

    const result = await runGoogleTrends(
      googleTrendsInputSchema.parse({ keywords: ['x'], date_from: '2025-01-01', date_to: '2025-06-30', include_series: false }),
    )

    const task = mockRequest.mock.calls[0][0].task
    expect(task).toMatchObject({ date_from: '2025-01-01', date_to: '2025-06-30' })
    expect(task).not.toHaveProperty('time_range')
    expect(result.success && 'series' in result).toBe(false)
  })

  it('marks missing-data points as null', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ items: [{ type: 'google_trends_graph', keywords: ['x'], data: [point('2025-10-05', [5]), point('2025-10-12', [0], true)] }] }],
      cost: 0.011,
    } as never)

    const result = await runGoogleTrends(googleTrendsInputSchema.parse({ keywords: ['x'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.series?.[1].values).toEqual([null])
      expect(result.summary[0].latest).toBe(5)
    }
  })

  it('returns NOT_FOUND when Trends has no graph data', async () => {
    mockRequest.mockResolvedValueOnce({ items: [{ items: [] }], cost: 0.011 } as never)
    const result = await runGoogleTrends(googleTrendsInputSchema.parse({ keywords: ['zzqx'] }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.NOT_FOUND)
  })
})
