import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ga4ConsentHealthInputSchema,
  ga4ConsentHealthTool,
  computeHealthScore,
  parseConsentModeRows,
  parseCustomEventRows,
  runDataApiReport,
  runGa4ConsentHealth,
} from './ga4-consent-health.js'

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

describe('ga4ConsentHealthInputSchema', () => {
  it('accepts valid minimal input', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
    })
    expect(result.success).toBe(true)
  })

  it('applies defaults', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.days).toBe(28)
    }
  })

  it('accepts all optional fields', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      days: 90,
      custom_grant_event: 'consent_granted',
      custom_deny_event: 'consent_denied',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing property_id', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects property_id without properties/ prefix', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: '123456789',
    })
    expect(result.success).toBe(false)
  })

  it('rejects property_id with wrong format', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects days above maximum', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      days: 366,
    })
    expect(result.success).toBe(false)
  })

  it('rejects days below minimum', () => {
    const result = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      days: 0,
    })
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// computeHealthScore
// ============================================================================

describe('computeHealthScore', () => {
  it('returns healthy when denied < 10%', () => {
    expect(computeHealthScore(0)).toBe('healthy')
    expect(computeHealthScore(5)).toBe('healthy')
    expect(computeHealthScore(9.9)).toBe('healthy')
  })

  it('returns warning when denied 10-30%', () => {
    expect(computeHealthScore(10)).toBe('warning')
    expect(computeHealthScore(20)).toBe('warning')
    expect(computeHealthScore(30)).toBe('warning')
  })

  it('returns critical when denied > 30%', () => {
    expect(computeHealthScore(30.1)).toBe('critical')
    expect(computeHealthScore(50)).toBe('critical')
    expect(computeHealthScore(100)).toBe('critical')
  })
})

// ============================================================================
// parseConsentModeRows
// ============================================================================

describe('parseConsentModeRows', () => {
  const makeRow = (
    analyticsStorage: string,
    adsStorage: string,
    sessions: number,
  ) => ({
    dimensionValues: [{ value: analyticsStorage }, { value: adsStorage }],
    metricValues: [{ value: String(sessions) }],
  })

  it('returns available=false for empty rows', () => {
    const result = parseConsentModeRows([])
    expect(result.available).toBe(false)
    expect(result.analytics_storage.total_sessions).toBe(0)
  })

  it('computes correct percentages for analytics_storage', () => {
    const rows = [
      makeRow('GRANTED', 'GRANTED', 700),
      makeRow('DENIED', 'DENIED', 200),
      makeRow('UNSET', 'UNSET', 100),
    ]
    const result = parseConsentModeRows(rows)
    expect(result.analytics_storage.granted_pct).toBe(70)
    expect(result.analytics_storage.denied_pct).toBe(20)
    expect(result.analytics_storage.unset_pct).toBe(10)
    expect(result.analytics_storage.total_sessions).toBe(1000)
  })

  it('computes correct percentages for ads_storage', () => {
    const rows = [
      makeRow('GRANTED', 'GRANTED', 800),
      makeRow('GRANTED', 'DENIED', 200),
    ]
    const result = parseConsentModeRows(rows)
    expect(result.ads_storage.granted_pct).toBe(80)
    expect(result.ads_storage.denied_pct).toBe(20)
  })

  it('sets available=true when granted or denied sessions exist', () => {
    const rows = [makeRow('GRANTED', 'GRANTED', 100)]
    const result = parseConsentModeRows(rows)
    expect(result.available).toBe(true)
  })

  it('sets available=false when all sessions are UNSET', () => {
    const rows = [makeRow('UNSET', 'UNSET', 1000)]
    const result = parseConsentModeRows(rows)
    expect(result.available).toBe(false)
  })

  it('handles aggregation of multiple GRANTED rows', () => {
    const rows = [
      makeRow('GRANTED', 'GRANTED', 300),
      makeRow('GRANTED', 'DENIED', 200),
    ]
    // analytics_storage: 500 granted, 0 denied = 100% granted
    const result = parseConsentModeRows(rows)
    expect(result.analytics_storage.granted_pct).toBe(100)
    expect(result.analytics_storage.denied_pct).toBe(0)
  })
})

// ============================================================================
// parseCustomEventRows
// ============================================================================

describe('parseCustomEventRows', () => {
  const makeRow = (eventName: string, count: number) => ({
    dimensionValues: [{ value: eventName }],
    metricValues: [{ value: String(count) }],
  })

  it('correctly parses grant and deny counts', () => {
    const rows = [
      makeRow('consent_granted', 800),
      makeRow('consent_denied', 200),
    ]
    const result = parseCustomEventRows(rows, 'consent_granted', 'consent_denied')
    expect(result.grant_count).toBe(800)
    expect(result.deny_count).toBe(200)
    expect(result.consent_rate_pct).toBe(80)
  })

  it('handles missing grant event', () => {
    const rows = [makeRow('consent_denied', 200)]
    const result = parseCustomEventRows(rows, 'consent_granted', 'consent_denied')
    expect(result.grant_count).toBe(0)
    expect(result.deny_count).toBe(200)
    expect(result.consent_rate_pct).toBe(0)
  })

  it('handles missing deny event', () => {
    const rows = [makeRow('consent_granted', 800)]
    const result = parseCustomEventRows(rows, 'consent_granted', 'consent_denied')
    expect(result.grant_count).toBe(800)
    expect(result.deny_count).toBe(0)
    expect(result.consent_rate_pct).toBe(100)
  })

  it('handles empty rows', () => {
    const result = parseCustomEventRows([], 'consent_granted', 'consent_denied')
    expect(result.grant_count).toBe(0)
    expect(result.deny_count).toBe(0)
    expect(result.consent_rate_pct).toBe(0)
  })

  it('echoes event names in output', () => {
    const rows: ReturnType<typeof makeRow>[] = []
    const result = parseCustomEventRows(rows, 'my_grant_event', 'my_deny_event')
    expect(result.grant_event).toBe('my_grant_event')
    expect(result.deny_event).toBe('my_deny_event')
  })
})

// ============================================================================
// runDataApiReport — API integration (mocked fetch)
// ============================================================================

describe('runDataApiReport', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('calls Data API with correct URL and auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await runDataApiReport('properties/123456789', {
      dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'privacyInfoAnalyticsStorage' }],
      metrics: [{ name: 'sessions' }],
    })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport',
    )
    expect(options.method).toBe('POST')
    const body = JSON.parse(options.body as string)
    expect(body.dimensions[0].name).toBe('privacyInfoAnalyticsStorage')
  })

  it('returns empty array when no rows in response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    )

    const rows = await runDataApiReport('properties/123456789', {})
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

    await expect(runDataApiReport('properties/123456789', {})).rejects.toThrow(
      'GA4 Data API access denied',
    )
  })

  it('throws descriptive error on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      }),
    )

    await expect(runDataApiReport('properties/123456789', {})).rejects.toThrow(
      'Property not found: properties/123456789',
    )
  })

  it('throws generic error on other HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      }),
    )

    await expect(runDataApiReport('properties/123456789', {})).rejects.toThrow(
      'GA4 Data API error (HTTP 500)',
    )
  })
})

// ============================================================================
// runGa4ConsentHealth — integration (mocked fetch)
// ============================================================================

describe('runGa4ConsentHealth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  const makeConsentRow = (
    analyticsStorage: string,
    adsStorage: string,
    sessions: number,
  ) => ({
    dimensionValues: [{ value: analyticsStorage }, { value: adsStorage }],
    metricValues: [{ value: String(sessions) }],
  })

  it('returns healthy score when few denied sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [
              makeConsentRow('GRANTED', 'GRANTED', 950),
              makeConsentRow('DENIED', 'DENIED', 50), // 5% denied
            ],
          }),
      }),
    )

    const input = ga4ConsentHealthInputSchema.parse({
      property_id: 'properties/123456789',
    })
    const result = await runGa4ConsentHealth(input)

    expect(result.success).toBe(true)
    expect(result.health_score).toBe('healthy')
    expect(result.consent_mode.analytics_storage.denied_pct).toBe(5)
    expect(result.consent_mode.available).toBe(true)
  })

  it('returns critical when consent mode unavailable (all UNSET)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [makeConsentRow('UNSET', 'UNSET', 1000)],
          }),
      }),
    )

    const input = ga4ConsentHealthInputSchema.parse({
      property_id: 'properties/123456789',
    })
    const result = await runGa4ConsentHealth(input)

    expect(result.success).toBe(true)
    // UNSET = 100% unset, 0% denied → healthy score since denied=0
    expect(result.health_score).toBe('healthy')
    expect(result.consent_mode.available).toBe(false)
  })

  it('includes custom_events when custom event names provided', async () => {
    const consentRows = [makeConsentRow('GRANTED', 'GRANTED', 1000)]
    const eventRows = [
      {
        dimensionValues: [{ value: 'consent_granted' }],
        metricValues: [{ value: '800' }],
      },
      {
        dimensionValues: [{ value: 'consent_denied' }],
        metricValues: [{ value: '200' }],
      },
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: consentRows }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ rows: eventRows }),
        }),
    )

    const input = ga4ConsentHealthInputSchema.parse({
      property_id: 'properties/123456789',
      custom_grant_event: 'consent_granted',
      custom_deny_event: 'consent_denied',
    })
    const result = await runGa4ConsentHealth(input)

    expect(result.success).toBe(true)
    expect(result.custom_events).toBeDefined()
    expect(result.custom_events?.grant_count).toBe(800)
    expect(result.custom_events?.deny_count).toBe(200)
    expect(result.custom_events?.consent_rate_pct).toBe(80)
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

    const input = ga4ConsentHealthInputSchema.parse({
      property_id: 'properties/123456789',
    })
    const result = await runGa4ConsentHealth(input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('GA4 Data API access denied')
  })

  it('includes period string in output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      }),
    )

    const input = ga4ConsentHealthInputSchema.parse({
      property_id: 'properties/123456789',
      days: 90,
    })
    const result = await runGa4ConsentHealth(input)

    expect(result.period).toBe('last 90 days')
  })
})

// ============================================================================
// Tool Definition
// ============================================================================

describe('ga4ConsentHealthTool definition', () => {
  it('has correct tool name', () => {
    expect(ga4ConsentHealthTool.name).toBe('ga4_consent_health')
  })

  it('has a descriptive description', () => {
    expect(ga4ConsentHealthTool.description).toContain('Consent Mode')
    expect(ga4ConsentHealthTool.description).toContain('GA4')
  })

  it('defines required fields', () => {
    expect(ga4ConsentHealthTool.inputSchema.required).toContain('property_id')
  })

  it('defines all optional parameters', () => {
    const props = ga4ConsentHealthTool.inputSchema.properties
    expect(props.days).toBeDefined()
    expect(props.custom_grant_event).toBeDefined()
    expect(props.custom_deny_event).toBeDefined()
  })
})
