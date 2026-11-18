import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReport, type DataApiResponse } from '../utils/ga4-data-client.js'
import { getPropertySettings } from '../utils/ga4-admin-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import type { CLIExecutor } from '../cli/executor.js'
import {
  evaluateHealth,
  overallStatus,
  runGa4MeasurementHealth,
  ga4MeasurementHealthInputSchema,
  type HealthInputs,
} from './ga4-measurement-health.js'

vi.mock('../utils/ga4-data-client.js', () => ({ runReport: vi.fn(), ANALYTICS_READONLY_SCOPE: 'scope' }))
vi.mock('../utils/ga4-admin-client.js', () => ({ getPropertySettings: vi.fn(), GSC_TIME_ZONE: 'America/Los_Angeles' }))
const mockRunReport = vi.mocked(runReport)
const mockSettings = vi.mocked(getPropertySettings)

const executor = { execute: vi.fn() } as unknown as CLIExecutor
const NOW = new Date('2026-03-15T10:00:00Z')

const v = (...ns: (number | string)[]) => ns.map((n) => ({ value: String(n) }))
const row = (dims: string[], metrics: (number | string)[]) => ({ dimensionValues: v(...dims), metricValues: v(...metrics) })
const rep = (...rows: ReturnType<typeof row>[]): DataApiResponse => ({ rows })

const HEALTHY: HealthInputs = {
  channels: rep(row(['Organic Search'], [600]), row(['Direct'], [400])),
  events: rep(row(['page_view'], [5000, 0]), row(['generate_lead'], [20, 20]), row(['consent_granted'], [300, 0]), row(['view_search_results'], [40, 0])),
  freshness: rep(row(['20260313'], [50]), row(['20260314'], [45])),
  landing: rep(row(['/guide'], [500]), row(['(not set)'], [10])),
  settings: { name: 'properties/123456789', display_name: 'Example', time_zone: 'America/Los_Angeles', currency_code: 'USD', create_time: null },
  settingsError: null,
  today: '2026-03-15',
  days: 28,
}

const byCheck = (checks: ReturnType<typeof evaluateHealth>) => Object.fromEntries(checks.map((c) => [c.check, c]))

describe('evaluateHealth', () => {
  it('passes a healthy property', () => {
    const checks = evaluateHealth(HEALTHY)
    expect(checks.map((c) => [c.check, c.status])).toEqual([
      ['sessions_recorded', 'pass'],
      ['organic_sessions', 'pass'],
      ['key_events', 'pass'],
      ['consent', 'pass'],
      ['data_freshness', 'pass'],
      ['organic_landing_pages', 'pass'],
      ['site_search', 'pass'],
      ['time_zone', 'pass'],
    ])
    expect(overallStatus(checks)).toBe('pass')
    expect(byCheck(checks).organic_sessions.detail).toMatch(/60%/)
  })

  it('explains no organic sessions, no key events, stale data, no consent events and a non-Pacific time zone', () => {
    const checks = byCheck(
      evaluateHealth({
        ...HEALTHY,
        channels: rep(row(['Direct'], [400])),
        events: rep(row(['page_view'], [5000, 0])),
        freshness: rep(row(['20260301'], [3])),
        landing: rep(),
        settings: { ...HEALTHY.settings!, time_zone: 'Europe/Madrid' },
      }),
    )
    expect(checks.organic_sessions).toMatchObject({ status: 'fail' })
    expect(checks.organic_sessions.how_to_fix).toMatch(/Referrer-Policy/)
    expect(checks.key_events).toMatchObject({ status: 'warn' })
    expect(checks.consent).toMatchObject({ status: 'warn' })
    expect(checks.consent.detail).toMatch(/does not expose Consent Mode/)
    expect(checks.data_freshness).toMatchObject({ status: 'fail' })
    expect(checks.time_zone).toMatchObject({ status: 'warn' })
    expect(checks.time_zone.detail).toMatch(/Europe\/Madrid/)
    expect(checks.organic_landing_pages).toBeUndefined()
    expect(checks.site_search).toMatchObject({ status: 'warn' })
  })

  it('fails when the property records nothing at all', () => {
    const checks = byCheck(evaluateHealth({ ...HEALTHY, channels: rep(), freshness: rep() }))
    expect(checks.sessions_recorded).toMatchObject({ status: 'fail' })
    expect(checks.organic_sessions).toBeUndefined()
    expect(checks.data_freshness.detail).toMatch(/No sessions in the last 10 days/)
  })

  it('computes a consent rate from custom events', () => {
    const checks = byCheck(
      evaluateHealth({
        ...HEALTHY,
        events: rep(row(['consent_granted'], [30, 0]), row(['consent_denied'], [70, 0])),
        grant_event: 'consent_granted',
        deny_event: 'consent_denied',
      }),
    )
    expect(checks.consent).toMatchObject({ status: 'warn' })
    expect(checks.consent.detail).toMatch(/Consent rate 30%/)
  })

  it('warns on many (not set) landing pages and unreadable settings', () => {
    const checks = byCheck(
      evaluateHealth({ ...HEALTHY, landing: rep(row(['/a'], [50]), row(['(not set)'], [50])), settings: null, settingsError: 'HTTP 403' }),
    )
    expect(checks.organic_landing_pages).toMatchObject({ status: 'warn' })
    expect(checks.time_zone).toMatchObject({ status: 'warn' })
    expect(checks.time_zone.detail).toMatch(/HTTP 403/)
  })
})

describe('runGa4MeasurementHealth', () => {
  beforeEach(() => {
    mockRunReport.mockReset()
    mockSettings.mockReset()
  })

  it('runs four reports and one admin read, returns overall status and property settings', async () => {
    mockRunReport
      .mockResolvedValueOnce(HEALTHY.channels)
      .mockResolvedValueOnce(HEALTHY.events)
      .mockResolvedValueOnce(HEALTHY.freshness)
      .mockResolvedValueOnce(HEALTHY.landing)
    mockSettings.mockResolvedValueOnce(HEALTHY.settings!)
    const r = await runGa4MeasurementHealth(ga4MeasurementHealthInputSchema.parse({ property_id: '123456789' }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.overall).toBe('pass')
    expect(r.property).toEqual({ display_name: 'Example', time_zone: 'America/Los_Angeles', currency_code: 'USD' })
    expect(r.window).toEqual({ start: '2026-02-15', end: '2026-03-14' })
    expect(mockRunReport).toHaveBeenCalledTimes(4)
  })

  it('a failed admin read degrades to a warning, a failed data report fails the tool', async () => {
    mockRunReport.mockResolvedValue(rep())
    mockSettings.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'no admin'))
    const r = await runGa4MeasurementHealth(ga4MeasurementHealthInputSchema.parse({ property_id: '123456789' }), executor, NOW)
    expect(r.success && r.overall).toBe('fail')
    expect(r.success && r.property).toBeNull()

    mockRunReport.mockReset()
    mockRunReport.mockRejectedValue(new ToolError(ErrorCode.NOT_FOUND, 'GA4 property not found'))
    mockSettings.mockResolvedValueOnce(HEALTHY.settings!)
    const r2 = await runGa4MeasurementHealth(ga4MeasurementHealthInputSchema.parse({ property_id: '123456789' }), executor, NOW)
    expect(r2).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })
})
