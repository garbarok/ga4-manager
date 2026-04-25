import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ga4ConsentHealthInputSchema,
  ga4ConsentHealthTool,
  runGa4ConsentHealth,
} from './ga4-consent-health.js'
import { computeConsentHealth } from './compute-consent-health.js'

vi.mock('../utils/google-auth.js', () => ({
  getGoogleAuthHeaders: vi.fn().mockResolvedValue({
    Authorization: 'Bearer mock-token',
  }),
}))

// ============================================================================
// Input schema
// ============================================================================

describe('ga4ConsentHealthInputSchema', () => {
  it('accepts minimal valid input', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      grant_event: 'consent_granted',
      deny_event: 'consent_denied',
    })
    expect(r.success).toBe(true)
  })

  it('applies default days=28 and view_event=page_view', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: '123456789',
      grant_event: 'consent_granted',
      deny_event: 'consent_denied',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.days).toBe(28)
      expect(r.data.view_event).toBe('page_view')
    }
  })

  it('accepts raw numeric property_id', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: '123456789',
      grant_event: 'consent_granted',
      deny_event: 'consent_denied',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing grant_event', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      deny_event: 'consent_denied',
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing deny_event', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      grant_event: 'consent_granted',
    })
    expect(r.success).toBe(false)
  })

  it('rejects days above 365', () => {
    const r = ga4ConsentHealthInputSchema.safeParse({
      property_id: 'properties/123456789',
      grant_event: 'g',
      deny_event: 'd',
      days: 366,
    })
    expect(r.success).toBe(false)
  })
})

// ============================================================================
// computeConsentHealth — pure function unit tests
// ============================================================================

const makeRow = (eventName: string, eventCount: number, totalUsers: number) => ({
  dimensionValues: [{ value: eventName }],
  metricValues: [{ value: String(eventCount) }, { value: String(totalUsers) }],
})

const DEFAULT_NAMES = {
  grant_event: 'consent_granted',
  deny_event: 'consent_denied',
  view_event: 'page_view',
}

describe('computeConsentHealth', () => {
  it('happy path — grant + deny + view all present', () => {
    const rows = [
      makeRow('consent_granted', 800, 750),
      makeRow('consent_denied', 200, 190),
      makeRow('page_view', 1200, 1100),
    ]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.available).toBe(true)
    expect(r.consent_rate_pct).toBe(80)
    expect(r.health_score).toBe('healthy')
    expect(r.events.grant_event.event_count).toBe(800)
    expect(r.events.deny_event.event_count).toBe(200)
    expect(r.events.view_event?.event_count).toBe(1200)
    expect(r.consent_visibility_pct).toBe(
      Math.round(((800 + 200) / 1200) * 1000) / 10,
    )
    expect(r.warnings).toHaveLength(0)
  })

  it('one event missing — only grant present — warns incomplete', () => {
    const rows = [makeRow('consent_granted', 800, 750)]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.available).toBe(true)
    expect(r.consent_rate_pct).toBe(100)
    expect(r.warnings).toContain(
      'only one consent event observed; banner instrumentation may be incomplete',
    )
  })

  it('one event missing — only deny present — warns incomplete', () => {
    const rows = [makeRow('consent_denied', 200, 190)]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.available).toBe(true)
    expect(r.consent_rate_pct).toBe(0)
    expect(r.warnings).toContain(
      'only one consent event observed; banner instrumentation may be incomplete',
    )
  })

  it('both events missing — available=false, health_score=no_data', () => {
    const r = computeConsentHealth([], DEFAULT_NAMES)
    expect(r.available).toBe(false)
    expect(r.health_score).toBe('no_data')
    expect(r.consent_rate_pct).toBeNull()
    expect(r.warnings).toHaveLength(0)
  })

  it('threshold 81% → healthy', () => {
    const rows = [
      makeRow('consent_granted', 810, 800),
      makeRow('consent_denied', 190, 180),
    ]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.health_score).toBe('healthy')
  })

  it('threshold 65% → warning', () => {
    const rows = [
      makeRow('consent_granted', 650, 640),
      makeRow('consent_denied', 350, 340),
    ]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.health_score).toBe('warning')
  })

  it('threshold 30% → critical', () => {
    const rows = [
      makeRow('consent_granted', 300, 290),
      makeRow('consent_denied', 700, 690),
    ]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.health_score).toBe('critical')
  })

  it('0% grant → critical', () => {
    const rows = [makeRow('consent_denied', 1000, 990)]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.consent_rate_pct).toBe(0)
    expect(r.health_score).toBe('critical')
  })

  it('division-by-zero safety — empty rows', () => {
    const r = computeConsentHealth([], DEFAULT_NAMES)
    expect(r.consent_rate_pct).toBeNull()
    expect(r.consent_visibility_pct).toBeNull()
  })

  it('view_event absent → consent_visibility_pct null', () => {
    const rows = [
      makeRow('consent_granted', 800, 750),
      makeRow('consent_denied', 200, 190),
    ]
    const r = computeConsentHealth(rows, DEFAULT_NAMES)
    expect(r.consent_visibility_pct).toBeNull()
    expect(r.events.view_event).toBeUndefined()
  })
})

// ============================================================================
// runGa4ConsentHealth — handler with mocked fetch
// ============================================================================

describe('runGa4ConsentHealth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  const baseInput = {
    property_id: 'properties/123456789',
    grant_event: 'consent_granted',
    deny_event: 'consent_denied',
  }

  it('happy path — returns healthy with event counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rows: [
              makeRow('consent_granted', 800, 750),
              makeRow('consent_denied', 100, 95),
              makeRow('page_view', 1200, 1100),
            ],
          }),
      }),
    )
    const input = ga4ConsentHealthInputSchema.parse(baseInput)
    const r = await runGa4ConsentHealth(input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.health_score).toBe('healthy')
      expect(r.available).toBe(true)
      expect(r.events.grant_event.event_count).toBe(800)
      expect(r.events.deny_event.event_count).toBe(100)
      expect(r.property_id).toBe('properties/123456789')
      expect(r.period).toBe('last 28 days')
    }
  })

  it('empty-rows fixture → available=false, health_score=no_data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      }),
    )
    const input = ga4ConsentHealthInputSchema.parse(baseInput)
    const r = await runGa4ConsentHealth(input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.available).toBe(false)
      expect(r.health_score).toBe('no_data')
      expect(r.warnings.length).toBeGreaterThan(0)
    }
  })

  it('403 → AUTH_DENIED error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      }),
    )
    const input = ga4ConsentHealthInputSchema.parse(baseInput)
    const r = await runGa4ConsentHealth(input)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe('AUTH_DENIED')
      expect(r.error.hint).toContain('PERMISSIONS.md')
    }
  })

  it('raw numeric property_id is normalized to properties/N', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rows: [] }),
      }),
    )
    const input = ga4ConsentHealthInputSchema.parse({
      ...baseInput,
      property_id: '987654321',
    })
    const r = await runGa4ConsentHealth(input)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.property_id).toBe('properties/987654321')
    }
  })

  it('G-XXXXXX Measurement ID → INVALID_INPUT error', async () => {
    const input = ga4ConsentHealthInputSchema.parse({
      ...baseInput,
      property_id: 'G-ABC123',
    })
    const r = await runGa4ConsentHealth(input)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe('INVALID_INPUT')
      expect(r.error.message).toContain('Measurement ID')
    }
  })
})

// ============================================================================
// Tool definition
// ============================================================================

describe('ga4ConsentHealthTool', () => {
  it('has correct tool name', () => {
    expect(ga4ConsentHealthTool.name).toBe('ga4_consent_health')
  })

  it('description mentions consent events and clarifies Consent Mode v2 unavailability', () => {
    expect(ga4ConsentHealthTool.description).toContain('consent_granted')
    expect(ga4ConsentHealthTool.description).toContain('Consent Mode v2')
    expect(ga4ConsentHealthTool.description).toContain('NOT exposed')
  })

  it('requires property_id, grant_event, deny_event', () => {
    expect(ga4ConsentHealthTool.inputSchema.required).toContain('property_id')
    expect(ga4ConsentHealthTool.inputSchema.required).toContain('grant_event')
    expect(ga4ConsentHealthTool.inputSchema.required).toContain('deny_event')
  })

  it('defines view_event and days as optional properties', () => {
    const props = ga4ConsentHealthTool.inputSchema.properties
    expect(props.view_event).toBeDefined()
    expect(props.days).toBeDefined()
  })
})
