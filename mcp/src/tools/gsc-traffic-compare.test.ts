import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  gscTrafficCompareInputSchema,
  gscTrafficCompareTool,
  compareTrafficPeriods,
  querySearchAnalytics,
  runGscTrafficCompare,
} from './gsc-traffic-compare.js'

// ============================================================================
// Mock google-auth utility
// ============================================================================

vi.mock('../utils/google-auth.js', () => ({
  getGoogleAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer mock-token',
  }),
}))

// ============================================================================
// Input Schema Validation
// ============================================================================

describe('gscTrafficCompareInputSchema', () => {
  it('accepts valid minimal input', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts full input with all optional fields', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'https://example.com/',
      period_a: { start: '2026-02-01', end: '2026-02-28' },
      period_b: { start: '2026-03-01', end: '2026-03-31' },
      dimensions: ['page', 'country'],
      limit: 1000,
      min_clicks_a: 10,
      sort_by: 'clicks_pct',
    })
    expect(result.success).toBe(true)
  })

  it('applies default values', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.dimensions).toEqual(['page'])
      expect(result.data.limit).toBe(500)
      expect(result.data.min_clicks_a).toBe(0)
      expect(result.data.sort_by).toBe('clicks_abs')
    }
  })

  it('rejects missing site', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing period_a', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format in period_a', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '01-03-2026', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format in period_b', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026/04/01', end: '2026-04-24' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects limit above maximum', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      limit: 25001,
    })
    expect(result.success).toBe(false)
  })

  it('rejects limit below minimum', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      limit: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid sort_by value', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      sort_by: 'invalid',
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid sort_by values', () => {
    for (const sort_by of ['clicks_abs', 'clicks_pct', 'impressions_abs'] as const) {
      const result = gscTrafficCompareInputSchema.safeParse({
        site: 'sc-domain:example.com',
        period_a: { start: '2026-03-01', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-24' },
        sort_by,
      })
      expect(result.success).toBe(true)
    }
  })
})

// ============================================================================
// compareTrafficPeriods — unit tests for diff logic
// ============================================================================

describe('compareTrafficPeriods', () => {
  const makeRow = (
    url: string,
    clicks: number,
    impressions = 1000,
    ctr = 0.05,
    position = 5.0,
  ) => ({
    keys: [url],
    clicks,
    impressions,
    ctr,
    position,
  })

  it('classifies URLs with >5% click drop as drops', () => {
    const rowsA = [makeRow('/page-a', 100)]
    const rowsB = [makeRow('/page-a', 80)] // -20% drop
    const { drops, gains } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(drops).toHaveLength(1)
    expect(drops[0].url).toBe('/page-a')
    expect(drops[0].clicks_delta).toBe(-20)
    expect(gains).toHaveLength(0)
  })

  it('classifies URLs with >5% click gain as gains', () => {
    const rowsA = [makeRow('/page-b', 100)]
    const rowsB = [makeRow('/page-b', 130)] // +30% gain
    const { drops, gains } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(gains).toHaveLength(1)
    expect(gains[0].url).toBe('/page-b')
    expect(gains[0].clicks_delta).toBe(30)
    expect(drops).toHaveLength(0)
  })

  it('counts URLs within ±5% as unchanged', () => {
    const rowsA = [makeRow('/page-c', 100)]
    const rowsB = [makeRow('/page-c', 103)] // +3% — unchanged
    const { drops, gains, unchanged } = compareTrafficPeriods(
      rowsA,
      rowsB,
      0,
      'clicks_abs',
    )
    expect(unchanged).toBe(1)
    expect(drops).toHaveLength(0)
    expect(gains).toHaveLength(0)
  })

  it('counts URLs only in period A vs only in period B', () => {
    const rowsA = [makeRow('/only-in-a', 50), makeRow('/common', 100)]
    const rowsB = [makeRow('/only-in-b', 50), makeRow('/common', 90)]
    const { summary } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(summary.urls_only_in_a).toBe(1)
    expect(summary.urls_only_in_b).toBe(1)
    expect(summary.urls_compared).toBe(1)
  })

  it('applies min_clicks_a filter', () => {
    const rowsA = [makeRow('/low-traffic', 3), makeRow('/high-traffic', 200)]
    const rowsB = [makeRow('/low-traffic', 1), makeRow('/high-traffic', 150)]
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 10, 'clicks_abs')
    // /low-traffic has 3 clicks in A < min_clicks_a=10, should be excluded
    expect(drops.every((d) => d.url !== '/low-traffic')).toBe(true)
    // /high-traffic has 200 clicks in A, should be included
    expect(drops.some((d) => d.url === '/high-traffic')).toBe(true)
  })

  it('sorts drops by clicks_abs (worst first)', () => {
    const rowsA = [makeRow('/big-drop', 1000), makeRow('/small-drop', 100)]
    const rowsB = [makeRow('/big-drop', 500), makeRow('/small-drop', 80)]
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(drops[0].url).toBe('/big-drop') // -500 clicks beats -20 clicks
  })

  it('sorts drops by clicks_pct when sort_by=clicks_pct', () => {
    // /pct-drop: 100->10 = -90%, /abs-drop: 1000->500 = -50%
    const rowsA = [makeRow('/pct-drop', 100), makeRow('/abs-drop', 1000)]
    const rowsB = [makeRow('/pct-drop', 10), makeRow('/abs-drop', 500)]
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_pct')
    expect(drops[0].url).toBe('/pct-drop') // -90% worse than -50%
  })

  it('sorts drops by impressions_abs when sort_by=impressions_abs', () => {
    const rowsA = [
      makeRow('/imp-drop', 100, 5000),
      makeRow('/small-imp-drop', 100, 500),
    ]
    const rowsB = [
      makeRow('/imp-drop', 80, 1000),
      makeRow('/small-imp-drop', 80, 400),
    ]
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'impressions_abs')
    expect(drops[0].url).toBe('/imp-drop') // -4000 impressions > -100
  })

  it('computes correct clicks_pct', () => {
    const rowsA = [makeRow('/page', 200)]
    const rowsB = [makeRow('/page', 100)] // -50%
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(drops[0].clicks_pct).toBe(-50)
  })

  it('handles zero clicks in period A gracefully', () => {
    const rowsA = [makeRow('/zero-clicks', 0)]
    const rowsB = [makeRow('/zero-clicks', 10)]
    // 0 clicks in A = 0% change formula -> unchanged (clips_pct = 0)
    const { unchanged } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(unchanged).toBe(1)
  })

  it('limits drops and gains to top 50', () => {
    // Create 60 drop URLs
    const rowsA = Array.from({ length: 60 }, (_, i) => makeRow(`/page-${i}`, 100))
    const rowsB = Array.from({ length: 60 }, (_, i) => makeRow(`/page-${i}`, 50))
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(drops).toHaveLength(50)
  })

  it('computes impressions_delta correctly', () => {
    const rowsA = [makeRow('/page', 100, 2000)]
    const rowsB = [makeRow('/page', 80, 1500)]
    const { drops } = compareTrafficPeriods(rowsA, rowsB, 0, 'clicks_abs')
    expect(drops[0].impressions_delta).toBe(-500)
  })

  it('returns empty drops/gains for empty input', () => {
    const { drops, gains, unchanged, summary } = compareTrafficPeriods(
      [],
      [],
      0,
      'clicks_abs',
    )
    expect(drops).toHaveLength(0)
    expect(gains).toHaveLength(0)
    expect(unchanged).toBe(0)
    expect(summary.urls_compared).toBe(0)
  })
})

// ============================================================================
// querySearchAnalytics — API integration (mocked fetch)
// ============================================================================

describe('querySearchAnalytics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls GSC API with correct parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          rows: [
            {
              keys: ['/page-a'],
              clicks: 100,
              impressions: 2000,
              ctr: 0.05,
              position: 3.5,
            },
          ],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const rows = await querySearchAnalytics(
      'sc-domain:example.com',
      '2026-03-01',
      '2026-03-31',
      ['page'],
      500,
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('sc-domain%3Aexample.com')
    expect(url).toContain('searchAnalytics/query')
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body as string)
    expect(body.startDate).toBe('2026-03-01')
    expect(body.endDate).toBe('2026-03-31')
    expect(body.dimensions).toEqual(['page'])
    expect(body.rowLimit).toBe(500)

    expect(rows).toHaveLength(1)
    expect(rows[0].clicks).toBe(100)
  })

  it('returns empty array when API returns no rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    )

    const rows = await querySearchAnalytics(
      'sc-domain:example.com',
      '2026-03-01',
      '2026-03-31',
      ['page'],
      500,
    )
    expect(rows).toHaveLength(0)
  })

  it('throws descriptive error on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }),
    )

    await expect(
      querySearchAnalytics('sc-domain:example.com', '2026-03-01', '2026-03-31', ['page'], 500),
    ).rejects.toThrow('GSC access denied')
  })

  it('throws descriptive error on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      }),
    )

    await expect(
      querySearchAnalytics('sc-domain:example.com', '2026-03-01', '2026-03-31', ['page'], 500),
    ).rejects.toThrow('GSC quota exceeded')
  })

  it('throws generic error on other HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      }),
    )

    await expect(
      querySearchAnalytics('sc-domain:example.com', '2026-03-01', '2026-03-31', ['page'], 500),
    ).rejects.toThrow('GSC API error (HTTP 500)')
  })
})

// ============================================================================
// runGscTrafficCompare — integration (mocked fetch)
// ============================================================================

describe('runGscTrafficCompare', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns successful comparison result', async () => {
    const mockRows = [
      {
        keys: ['/page-a'],
        clicks: 100,
        impressions: 2000,
        ctr: 0.05,
        position: 3.5,
      },
    ]
    const mockDropRows = [
      {
        keys: ['/page-a'],
        clicks: 70, // -30% drop
        impressions: 1500,
        ctr: 0.047,
        position: 4.0,
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: mockRows }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: mockDropRows }),
        }),
    )

    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })

    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(true)
    expect(result.site).toBe('sc-domain:example.com')
    expect(result.period_a).toBe('2026-03-01 to 2026-03-31')
    expect(result.period_b).toBe('2026-04-01 to 2026-04-24')
    expect(result.drops).toHaveLength(1)
    expect(result.drops[0].url).toBe('/page-a')
    expect(result.drops[0].clicks_delta).toBe(-30)
    expect(result.gains).toHaveLength(0)
  })

  it('returns error result on API failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }),
    )

    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })

    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('GSC access denied')
    expect(result.drops).toHaveLength(0)
    expect(result.gains).toHaveLength(0)
  })
})

// ============================================================================
// Tool Definition
// ============================================================================

describe('gscTrafficCompareTool definition', () => {
  it('has correct tool name', () => {
    expect(gscTrafficCompareTool.name).toBe('gsc_traffic_compare')
  })

  it('has a descriptive description', () => {
    expect(gscTrafficCompareTool.description).toContain('GSC')
    expect(gscTrafficCompareTool.description).toContain('traffic')
  })

  it('defines required fields in schema', () => {
    expect(gscTrafficCompareTool.inputSchema.required).toContain('site')
    expect(gscTrafficCompareTool.inputSchema.required).toContain('period_a')
    expect(gscTrafficCompareTool.inputSchema.required).toContain('period_b')
  })

  it('defines all optional parameters', () => {
    const props = gscTrafficCompareTool.inputSchema.properties
    expect(props.dimensions).toBeDefined()
    expect(props.limit).toBeDefined()
    expect(props.min_clicks_a).toBeDefined()
    expect(props.sort_by).toBeDefined()
  })

  it('defines period_a and period_b as objects with start/end', () => {
    const props = gscTrafficCompareTool.inputSchema.properties
    expect(props.period_a.type).toBe('object')
    expect(props.period_a.properties.start).toBeDefined()
    expect(props.period_a.properties.end).toBeDefined()
    expect(props.period_b.type).toBe('object')
    expect(props.period_b.properties.start).toBeDefined()
    expect(props.period_b.properties.end).toBeDefined()
  })
})
