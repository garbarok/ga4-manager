import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  gscTrafficCompareInputSchema,
  gscTrafficCompareTool,
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
      fetch_limit: 2000,
      output_limit: 100,
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
      expect(result.data.fetch_limit).toBe(5000)
      expect(result.data.output_limit).toBe(50)
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

  it('rejects fetch_limit above maximum', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      fetch_limit: 25001,
    })
    expect(result.success).toBe(false)
  })

  it('rejects fetch_limit below minimum', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      fetch_limit: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects output_limit above maximum', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      output_limit: 501,
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

  it('accepts normalize field with valid values', () => {
    for (const normalize of ['none', 'minimal', 'aggressive'] as const) {
      const result = gscTrafficCompareInputSchema.safeParse({
        site: 'sc-domain:example.com',
        period_a: { start: '2026-03-01', end: '2026-03-31' },
        period_b: { start: '2026-04-01', end: '2026-04-24' },
        normalize,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid normalize value', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
      normalize: 'extreme',
    })
    expect(result.success).toBe(false)
  })

  it('defaults normalize to "minimal"', () => {
    const result = gscTrafficCompareInputSchema.safeParse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.normalize).toBe('minimal')
    }
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
    const body = JSON.parse(options.body as string) as Record<string, unknown>
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
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
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

  it('throws ToolError AUTH_DENIED on 403', async () => {
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
    ).rejects.toMatchObject({ code: 'AUTH_DENIED' })
  })

  it('throws ToolError QUOTA_EXCEEDED on 429', async () => {
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
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })

  it('throws ToolError UPSTREAM_5XX on other HTTP failures', async () => {
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
    ).rejects.toMatchObject({ code: 'UPSTREAM_5XX' })
  })
})

// ============================================================================
// runGscTrafficCompare — integration (mocked fetch)
// ============================================================================

// Use same-length periods safely in the past (no lag warning, no length mismatch)
const baseInput = {
  site: 'sc-domain:example.com',
  period_a: { start: '2026-01-01', end: '2026-01-31' },
  period_b: { start: '2026-02-01', end: '2026-03-03' },
}

describe('runGscTrafficCompare', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns INVALID_INPUT when fetch_limit <= output_limit', async () => {
    const input = gscTrafficCompareInputSchema.parse({
      ...baseInput,
      fetch_limit: 50,
      output_limit: 50,
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT')
      expect(result.error.message).toContain('fetch_limit')
    }
  })

  it('happy path: returns success with drops/gains/summary and normalize_mode_used', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ keys: ['/page-a'], clicks: 100, impressions: 2000, ctr: 0.05, position: 3.5 }],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [{ keys: ['/page-a'], clicks: 70, impressions: 1500, ctr: 0.047, position: 4.0 }],
            }),
        }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.site).toBe('sc-domain:example.com')
      expect(result.period_a).toBe('2026-01-01 to 2026-01-31')
      expect(result.period_b).toBe('2026-02-01 to 2026-03-03')
      expect(result.drops).toHaveLength(1)
      expect(result.drops[0].url).toBe('/page-a')
      expect(result.drops[0].clicks_delta).toBe(-30)
      expect(result.drops[0]).toHaveProperty('ctr_delta')
      expect(result.drops[0]).toHaveProperty('position_delta')
      expect(result.gains).toHaveLength(0)
      expect(result.drops_tail).toMatchObject({ count: 0, total_clicks_delta: 0, sample: [] })
      expect(result.gains_tail).toMatchObject({ count: 0, total_clicks_delta: 0, sample: [] })
      expect(result.warnings).toEqual([])
      expect(result.normalize_mode_used).toBe('minimal')
    }
  })

  it('both periods fail → AUTH_DENIED when both return 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUTH_DENIED')
      expect(result.error.hint).toBeTruthy()
    }
  })

  it('both periods fail → QUOTA_EXCEEDED when both return 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('QUOTA_EXCEEDED')
    }
  })

  it('both periods fail → UPSTREAM_5XX on 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPSTREAM_5XX')
    }
  })

  it('single period fail → PARTIAL_FETCH_FAILED (period_b fails)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: [] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server Error'),
        }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PARTIAL_FETCH_FAILED')
      expect(result.error.message).toContain('period_b')
      expect(result.error.hint).toContain('period_a succeeded')
    }
  })

  it('single period fail → PARTIAL_FETCH_FAILED (period_a fails)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: [] }),
        }),
    )

    const input = gscTrafficCompareInputSchema.parse(baseInput)
    const result = await runGscTrafficCompare(input)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PARTIAL_FETCH_FAILED')
      expect(result.error.message).toContain('period_a')
      expect(result.error.hint).toContain('period_b succeeded')
    }
  })
})

// ============================================================================
// Date validation + warnings
// ============================================================================

describe('runGscTrafficCompare — date validation and warnings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  const emptyFetch = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [] }),
    })

  it('returns INVALID_INPUT when period_a start > end', async () => {
    const input = gscTrafficCompareInputSchema.parse({
      ...baseInput,
      period_a: { start: '2026-03-31', end: '2026-03-01' },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT')
      expect(result.error.message).toContain('period_a')
    }
  })

  it('returns INVALID_INPUT when period_b start > end', async () => {
    const input = gscTrafficCompareInputSchema.parse({
      ...baseInput,
      period_b: { start: '2026-04-30', end: '2026-04-01' },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT')
      expect(result.error.message).toContain('period_b')
    }
  })

  it('warns when periods overlap (period_a.end >= period_b.start)', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-04-10' },
      period_b: { start: '2026-04-01', end: '2026-04-24' },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.warnings.some((w) => w.toLowerCase().includes('overlap'))).toBe(true)
    }
  })

  it('warns when period_b.end is within 48-hour GSC lag window', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-03-01', end: '2026-03-31' },
      period_b: { start: yesterday, end: today },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.warnings.some((w) => w.includes('48 hours') || w.includes('incomplete'))).toBe(true)
    }
  })

  it('warns when periods are different lengths', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-01-01', end: '2026-01-31' }, // 31 days
      period_b: { start: '2026-02-01', end: '2026-02-14' }, // 14 days
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.warnings.some((w) => w.includes('different lengths'))).toBe(true)
    }
  })

  it('no warning when periods are same length and non-overlapping', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const input = gscTrafficCompareInputSchema.parse({
      site: 'sc-domain:example.com',
      period_a: { start: '2026-01-01', end: '2026-01-31' },
      period_b: { start: '2026-02-01', end: '2026-03-03' }, // also 31 days
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      const nonLagWarnings = result.warnings.filter(
        (w) => !w.includes('48 hours') && !w.includes('incomplete'),
      )
      expect(nonLagWarnings).toHaveLength(0)
    }
  })

  it('warns when raw domain site input is normalised to sc-domain', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const input = gscTrafficCompareInputSchema.parse({
      site: 'example.com',
      period_a: { start: '2026-01-01', end: '2026-01-31' },
      period_b: { start: '2026-02-01', end: '2026-03-03' },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.warnings.some((w) => w.includes('sc-domain'))).toBe(true)
      expect(result.site).toBe('sc-domain:example.com')
    }
  })

  it('normalised site warning included when https URL missing trailing slash', async () => {
    vi.stubGlobal('fetch', emptyFetch())
    const input = gscTrafficCompareInputSchema.parse({
      site: 'https://example.com',
      period_a: { start: '2026-01-01', end: '2026-01-31' },
      period_b: { start: '2026-02-01', end: '2026-03-03' },
    })
    const result = await runGscTrafficCompare(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.warnings.some((w) => w.includes('trailing slash'))).toBe(true)
      expect(result.site).toBe('https://example.com/')
    }
  })
})

// ============================================================================
// Tool Definition
// ============================================================================

describe('gscTrafficCompareTool definition', () => {
  it('has correct tool name', () => {
    expect(gscTrafficCompareTool.name).toBe('gsc_traffic_compare')
  })

  it('description is use-case-driven and mentions quota', () => {
    expect(gscTrafficCompareTool.description.toLowerCase()).toContain('traffic')
    expect(gscTrafficCompareTool.description).toContain('2 GSC requests')
  })

  it('defines required fields in schema', () => {
    expect(gscTrafficCompareTool.inputSchema.required).toContain('site')
    expect(gscTrafficCompareTool.inputSchema.required).toContain('period_a')
    expect(gscTrafficCompareTool.inputSchema.required).toContain('period_b')
  })

  it('defines all optional parameters including normalize', () => {
    const { properties: props } = gscTrafficCompareTool.inputSchema
    expect(props.dimensions).toBeDefined()
    expect(props.fetch_limit).toBeDefined()
    expect(props.output_limit).toBeDefined()
    expect(props.min_clicks_a).toBeDefined()
    expect(props.sort_by).toBeDefined()
    expect(props.normalize).toBeDefined()
  })

  it('period_a and period_b are objects with start/end', () => {
    const { properties: props } = gscTrafficCompareTool.inputSchema
    expect(props.period_a.type).toBe('object')
    expect(props.period_a.properties.start).toBeDefined()
    expect(props.period_a.properties.end).toBeDefined()
    expect(props.period_b.type).toBe('object')
    expect(props.period_b.properties.start).toBeDefined()
    expect(props.period_b.properties.end).toBeDefined()
  })
})
