import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReport, type DataApiResponse } from '../utils/ga4-data-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import type { CLIExecutor } from '../cli/executor.js'
import { windows, pctDelta, andFilters, ORGANIC_FILTER } from './ga4-organic-shared.js'
import {
  compareMetrics,
  formatPeriod,
  runGa4OrganicOverview,
  ga4OrganicOverviewInputSchema,
  runGa4OrganicLandingPages,
  ga4OrganicLandingPagesInputSchema,
  runGa4KeyEvents,
  ga4KeyEventsInputSchema,
  runGa4TrafficAcquisition,
  ga4TrafficAcquisitionInputSchema,
  runGa4Audience,
  ga4AudienceInputSchema,
  runGa4SiteSearch,
  ga4SiteSearchInputSchema,
  SITE_SEARCH_EMPTY_HINT,
  runGa4Ecommerce,
  ga4EcommerceInputSchema,
  ECOMMERCE_EMPTY_HINT,
} from './ga4-organic-reports.js'

vi.mock('../utils/ga4-data-client.js', () => ({ runReport: vi.fn(), ANALYTICS_READONLY_SCOPE: 'scope' }))
const mockRunReport = vi.mocked(runReport)

const NOW = new Date('2026-03-15T10:00:00Z')
const PROPERTY = '123456789'

const executor = { execute: vi.fn() } as unknown as CLIExecutor & { execute: ReturnType<typeof vi.fn> }

const v = (...ns: (number | string)[]) => ns.map((n) => ({ value: String(n) }))
const row = (dims: string[], metrics: (number | string)[]) => ({ dimensionValues: v(...dims), metricValues: v(...metrics) })
const report = (rows: ReturnType<typeof row>[], totals?: (number | string)[], rowCount?: number): DataApiResponse => ({
  rows,
  ...(totals ? { totals: [row(['RESERVED_TOTAL'], totals)] } : {}),
  rowCount: rowCount ?? rows.length,
})

beforeEach(() => {
  mockRunReport.mockReset()
  executor.execute.mockReset()
})

type Body = Record<string, unknown>
const bodyOf = (call: number): Body => mockRunReport.mock.calls[call][1] as Body

describe('shared helpers', () => {
  it('windows: N days ending yesterday and the equal window before', () => {
    expect(windows(7, NOW)).toEqual({
      current: { start: '2026-03-08', end: '2026-03-14' },
      previous: { start: '2026-03-01', end: '2026-03-07' },
    })
  })
  it('pctDelta and andFilters', () => {
    expect(pctDelta(110, 100)).toBe(0.1)
    expect(pctDelta(5, 0)).toBeNull()
    expect(andFilters(undefined)).toBeUndefined()
    expect(andFilters(ORGANIC_FILTER)).toBe(ORGANIC_FILTER)
    expect(andFilters(ORGANIC_FILTER, ORGANIC_FILTER)).toEqual({ andGroup: { expressions: [ORGANIC_FILTER, ORGANIC_FILTER] } })
  })
  it('formatPeriod', () => {
    expect(formatPeriod('20260301', 'day')).toBe('2026-03-01')
    expect(formatPeriod('202609', 'week')).toBe('2026-W09')
  })
  it('compareMetrics', () => {
    expect(compareMetrics({ sessions: 120 }, { sessions: 100 })).toEqual({ sessions: { current: 120, previous: 100, change: 20, change_pct: 0.2 } })
  })
})

describe('ga4_organic_overview', () => {
  // OVERVIEW order: sessions, engaged, engagementRate, keyEvents, sessionKeyEventRate, revenue, users, newUsers, avgDuration
  const CUR = report([row([], [1200, 700, 0.58333, 36, 0.025, 120.5, 1000, 800, 61.27])])
  const PREV = report([row([], [1000, 550, 0.55, 30, 0.02, 100, 850, 700, 58])])
  const ALL = report([row([], [3000])])
  const TREND = report([row(['20260308'], [150, 80, 0.53, 4, 0.02, 10]), row(['20260309'], [170, 90, 0.53, 5, 0.03, 20])])

  it('compares with the previous window, reports organic share and a daily trend', async () => {
    mockRunReport.mockResolvedValueOnce(CUR).mockResolvedValueOnce(PREV).mockResolvedValueOnce(ALL).mockResolvedValueOnce(TREND)
    const r = await runGa4OrganicOverview(ga4OrganicOverviewInputSchema.parse({ property_id: PROPERTY, days: 7 }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.window).toEqual({ start: '2026-03-08', end: '2026-03-14' })
    expect(r.previous_window).toEqual({ start: '2026-03-01', end: '2026-03-07' })
    expect(r.metrics.sessions).toEqual({ current: 1200, previous: 1000, change: 200, change_pct: 0.2 })
    expect(r.metrics.engagement_rate.current).toBe(0.5833)
    expect(r.metrics.revenue).toMatchObject({ current: 120.5, previous: 100 })
    expect(r.organic_share_of_sessions).toBe(0.4)
    expect(r.trend.map((t) => t.period)).toEqual(['2026-03-08', '2026-03-09'])
    expect(r.warnings).toEqual([])
    // organic filter on current/previous/trend, not on the all-sessions denominator
    expect(bodyOf(0).dimensionFilter).toEqual(ORGANIC_FILTER)
    expect(bodyOf(1).dateRanges).toEqual([{ startDate: '2026-03-01', endDate: '2026-03-07' }])
    expect(bodyOf(2).dimensionFilter).toBeUndefined()
    expect(bodyOf(3).dimensions).toEqual([{ name: 'date' }])
  })

  it('weekly trend uses isoYearIsoWeek; empty organic data explains itself', async () => {
    mockRunReport
      .mockResolvedValueOnce(report([]))
      .mockResolvedValueOnce(report([]))
      .mockResolvedValueOnce(report([row([], [50])]))
      .mockResolvedValueOnce(report([]))
    const r = await runGa4OrganicOverview(ga4OrganicOverviewInputSchema.parse({ property_id: PROPERTY, granularity: 'week' }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(bodyOf(3).dimensions).toEqual([{ name: 'isoYearIsoWeek' }])
    expect(r.metrics.sessions.change_pct).toBeNull()
    expect(r.organic_share_of_sessions).toBe(0)
    expect(r.warnings[0]).toMatch(/no Organic Search sessions/)
  })

  it('resolves property from config and maps API errors', async () => {
    executor.execute.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify([{ path: 'c.yaml', project: 'x', property_id: '123456789', gsc_site: 'sc-domain:example.com', hreflang_pairs: [] }]),
      stderr: '',
    })
    mockRunReport.mockRejectedValue(new ToolError(ErrorCode.AUTH_DENIED, 'denied', 'grant Viewer'))
    const r = await runGa4OrganicOverview(ga4OrganicOverviewInputSchema.parse({ config: 'c.yaml' }), executor, NOW)
    expect(r).toEqual({ success: false, error: { code: 'AUTH_DENIED', message: 'denied', hint: 'grant Viewer' } })
    expect(mockRunReport.mock.calls[0][0]).toBe('properties/123456789')
  })

  it('rejects a measurement ID and missing property', async () => {
    const r1 = await runGa4OrganicOverview(ga4OrganicOverviewInputSchema.parse({ property_id: 'G-ABC123' }), executor, NOW)
    expect(r1).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    const r2 = await runGa4OrganicOverview(ga4OrganicOverviewInputSchema.parse({}), executor, NOW)
    expect(r2).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    expect(mockRunReport).not.toHaveBeenCalled()
  })
})

describe('ga4_organic_landing_pages', () => {
  it('orders by the chosen metric, maps rows and totals, flags (not set)', async () => {
    mockRunReport.mockResolvedValueOnce(
      report(
        [
          row(['/guide'], [500, 300, 0.6, 10, 0.02, 0, 70.04]),
          row(['(not set)'], [200, 20, 0.1, 0, 0, 0, 3]),
          row(['/pricing'], [100, 80, 0.8, 9, 0.09, 49.999, 120]),
        ],
        [800, 400, 0.5, 19, 0.024, 50, 60],
        3,
      ),
    )
    const r = await runGa4OrganicLandingPages(
      ga4OrganicLandingPagesInputSchema.parse({ property_id: PROPERTY, order_by: 'key_events', limit: 10 }),
      executor,
      NOW,
    )
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(bodyOf(0).orderBys).toEqual([{ metric: { metricName: 'keyEvents' }, desc: true }])
    expect(bodyOf(0).dimensions).toEqual([{ name: 'landingPage' }])
    expect(bodyOf(0).dimensionFilter).toEqual(ORGANIC_FILTER)
    expect(r.rows[0]).toEqual({
      landing_page: '/guide',
      sessions: 500,
      engaged_sessions: 300,
      engagement_rate: 0.6,
      key_events: 10,
      session_key_event_rate: 0.02,
      revenue: 0,
      avg_session_duration_s: 70,
    })
    expect(r.rows[2].revenue).toBe(50)
    expect(r.totals.sessions).toBe(800)
    expect(r.warnings.join(' ')).toMatch(/not set/)
  })

  it('all channels with query strings; empty → explanation', async () => {
    mockRunReport.mockResolvedValueOnce(report([]))
    const r = await runGa4OrganicLandingPages(
      ga4OrganicLandingPagesInputSchema.parse({ property_id: PROPERTY, organic: false, include_query_string: true }),
      executor,
      NOW,
    )
    expect(bodyOf(0).dimensions).toEqual([{ name: 'landingPagePlusQueryString' }])
    expect(bodyOf(0).dimensionFilter).toBeUndefined()
    expect(r.success && r.warnings[0]).toMatch(/no sessions/)
  })
})

describe('ga4_key_events', () => {
  it('lists key events with counts, filtered to > 0', async () => {
    mockRunReport.mockResolvedValueOnce(report([row(['generate_lead'], [12, 10]), row(['sign_up'], [3, 3])], [15, 13]))
    const r = await runGa4KeyEvents(ga4KeyEventsInputSchema.parse({ property_id: PROPERTY }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.rows).toEqual([
      { event_name: 'generate_lead', key_events: 12, users: 10 },
      { event_name: 'sign_up', key_events: 3, users: 3 },
    ])
    expect(r.total_key_events).toBe(15)
    expect(bodyOf(0).metricFilter).toBeDefined()
  })

  it('by landing page; empty explains configuration', async () => {
    mockRunReport.mockResolvedValueOnce(report([]))
    const r = await runGa4KeyEvents(ga4KeyEventsInputSchema.parse({ property_id: PROPERTY, by_landing_page: true }), executor, NOW)
    expect(bodyOf(0).dimensions).toEqual([{ name: 'eventName' }, { name: 'landingPage' }])
    expect(r.success && r.warnings[0]).toMatch(/Mark as key event/)
  })
})

describe('ga4_traffic_acquisition', () => {
  it('channel breakdown with share of sessions', async () => {
    mockRunReport.mockResolvedValueOnce(
      report(
        [row(['Organic Search'], [600, 300, 0.5, 6, 0.01, 0, 500, 400]), row(['Direct'], [400, 100, 0.25, 2, 0.005, 0, 350, 300])],
        [1000, 400, 0.4, 8, 0.008, 0, 850, 700],
      ),
    )
    const r = await runGa4TrafficAcquisition(ga4TrafficAcquisitionInputSchema.parse({ property_id: PROPERTY }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.rows[0]).toMatchObject({ channel: 'Organic Search', sessions: 600, share_of_sessions: 0.6, users: 500 })
    expect(r.warnings).toEqual([])
  })

  it('source/medium breakdown dims; missing organic channel warns', async () => {
    mockRunReport.mockResolvedValueOnce(report([row(['Direct', '(direct) / (none)'], [10, 1, 0.1, 0, 0, 0, 9, 9])], [10, 1, 0.1, 0, 0, 0, 9, 9]))
    const r = await runGa4TrafficAcquisition(
      ga4TrafficAcquisitionInputSchema.parse({ property_id: PROPERTY, breakdown: 'channel_source_medium' }),
      executor,
      NOW,
    )
    expect(bodyOf(0).dimensions).toEqual([{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSourceMedium' }])
    expect(r.success && r.rows[0].source_medium).toBe('(direct) / (none)')
    expect(r.success && r.warnings[0]).toMatch(/no Organic Search sessions/)
  })
})

describe('ga4_audience', () => {
  it.each([
    ['country', 'country'],
    ['device', 'deviceCategory'],
    ['new_vs_returning', 'newVsReturning'],
  ])('%s uses %s', async (breakdown, apiDim) => {
    mockRunReport.mockResolvedValueOnce(report([row(['x'], [10, 5, 20, 0.5, 1, 0.05])], [10, 5, 20, 0.5, 1, 0.05]))
    const r = await runGa4Audience(ga4AudienceInputSchema.parse({ property_id: PROPERTY, breakdown }), executor, NOW)
    expect(bodyOf(0).dimensions).toEqual([{ name: apiDim }])
    expect(r.success && r.rows[0]).toMatchObject({ [breakdown]: 'x', users: 10, sessions: 20, share_of_sessions: 1 })
  })

  it('warns about (not set) new vs returning', async () => {
    mockRunReport.mockResolvedValueOnce(report([row(['(not set)'], [1, 1, 1, 0, 0, 0])], [1, 1, 1, 0, 0, 0]))
    const r = await runGa4Audience(ga4AudienceInputSchema.parse({ property_id: PROPERTY, breakdown: 'new_vs_returning' }), executor, NOW)
    expect(r.success && r.warnings[0]).toMatch(/Consent Mode/)
  })
})

describe('ga4_site_search', () => {
  it('lists search terms from view_search_results, dropping (not set)', async () => {
    mockRunReport.mockResolvedValueOnce(report([row(['pricing'], [12, 9]), row(['(not set)'], [4, 4])], [16, 13]))
    const r = await runGa4SiteSearch(ga4SiteSearchInputSchema.parse({ property_id: PROPERTY }), executor, NOW)
    expect(r.success && r.rows).toEqual([{ search_term: 'pricing', searches: 12, users: 9 }])
    expect(bodyOf(0).dimensionFilter).toEqual({ filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'view_search_results' } } })
  })

  it('organic filter is ANDed; empty explains enhanced measurement', async () => {
    mockRunReport.mockResolvedValueOnce(report([]))
    const r = await runGa4SiteSearch(ga4SiteSearchInputSchema.parse({ property_id: PROPERTY, organic: true }), executor, NOW)
    expect(bodyOf(0).dimensionFilter).toHaveProperty('andGroup')
    expect(r.success && r.warnings).toEqual([SITE_SEARCH_EMPTY_HINT])
  })
})

describe('ga4_ecommerce', () => {
  it('totals and items, organic', async () => {
    mockRunReport
      .mockResolvedValueOnce(report([row([], [4, 199.96, 49.99, 210])]))
      .mockResolvedValueOnce(report([row(['Widget'], [100, 20, 4, 199.96])]))
    const r = await runGa4Ecommerce(ga4EcommerceInputSchema.parse({ property_id: PROPERTY }), executor, NOW)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.totals).toEqual({ purchases: 4, purchase_revenue: 199.96, average_purchase_revenue: 49.99, total_revenue: 210 })
    expect(r.items[0]).toEqual({ item_name: 'Widget', items_viewed: 100, items_added_to_cart: 20, items_purchased: 4, item_revenue: 199.96 })
    expect(r.items_filtered_to_organic).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('retries items without the channel filter when GA4 rejects it', async () => {
    mockRunReport
      .mockResolvedValueOnce(report([row([], [1, 10, 10, 10])]))
      .mockRejectedValueOnce(new ToolError(ErrorCode.INVALID_INPUT, 'incompatible'))
      .mockResolvedValueOnce(report([row(['Widget'], [5, 1, 1, 10])]))
    const r = await runGa4Ecommerce(ga4EcommerceInputSchema.parse({ property_id: PROPERTY }), executor, NOW)
    expect(r.success && r.items_filtered_to_organic).toBe(false)
    expect(r.success && r.warnings[0]).toMatch(/all channels/)
    expect(bodyOf(2).dimensionFilter).toBeUndefined()
  })

  it('empty → explains missing ecommerce tracking', async () => {
    mockRunReport.mockResolvedValueOnce(report([])).mockResolvedValueOnce(report([]))
    const r = await runGa4Ecommerce(ga4EcommerceInputSchema.parse({ property_id: PROPERTY, organic: false }), executor, NOW)
    expect(r.success && r.warnings).toEqual([ECOMMERCE_EMPTY_HINT])
  })
})
