import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReport } from '../utils/ga4-data-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import type { CLIExecutor } from '../cli/executor.js'
import {
  AD_REVENUE_UNAVAILABLE,
  ga4TrafficReportInputSchema,
  ga4TrafficReportTool,
  runGa4TrafficReport,
  toTrafficMetrics,
} from './ga4-traffic-report.js'

vi.mock('../utils/ga4-data-client.js', () => ({ runReport: vi.fn() }))

const mockRunReport = vi.mocked(runReport)

/** Metric values in the tool's request order. */
function metrics(
  sessions: number,
  engaged: number,
  rate: number,
  duration: number,
  views: number,
  revenue: number,
  adImpr: number,
  adClicks: number,
) {
  return [sessions, engaged, rate, duration, views, revenue, adImpr, adClicks].map((n) => ({ value: String(n) }))
}

// A property with AdSense linked.
const LINKED = {
  rows: [
    { dimensionValues: [{ value: '/calculator/mortgage-calculator' }], metricValues: metrics(2000, 900, 0.5621, 88.3, 2200, 4.54, 3000, 20) },
    { dimensionValues: [{ value: '/calculator/calculadora-hipoteca' }], metricValues: metrics(800, 400, 0.4926, 71.04, 900, 1.2, 2000, 9) },
  ],
  totals: [{ dimensionValues: [{ value: 'RESERVED_TOTAL' }], metricValues: metrics(3200, 1600, 0.5, 80, 3600, 5.6, 7000, 40) }],
  rowCount: 43,
}

const UNLINKED = {
  rows: [{ dimensionValues: [{ value: '/' }], metricValues: metrics(100, 50, 0.5, 30, 120, 0, 0, 0) }],
  totals: [{ dimensionValues: [{ value: 'RESERVED_TOTAL' }], metricValues: metrics(100, 50, 0.5, 30, 120, 0, 0, 0) }],
  rowCount: 1,
}

const executor = { execute: vi.fn() } as unknown as CLIExecutor & { execute: ReturnType<typeof vi.fn> }

beforeEach(() => {
  mockRunReport.mockReset()
  executor.execute.mockReset()
})

const run = (raw: Record<string, unknown>) => runGa4TrafficReport(ga4TrafficReportInputSchema.parse(raw), executor)

describe('runGa4TrafficReport', () => {
  it('default call: pagePath, 28 days ending yesterday, ordered by sessions, 50 rows, with totals', async () => {
    mockRunReport.mockResolvedValueOnce(LINKED)
    const r = await run({ property_id: '123456789' })
    expect(r.success).toBe(true)

    const [propertyId, body] = mockRunReport.mock.calls[0]
    expect(propertyId).toBe('properties/123456789')
    expect(body).toMatchObject({
      dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
      dimensions: [{ name: 'pagePath' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: 50,
    })

    if (r.success) {
      expect(r.rows[0]).toMatchObject({
        pagePath: '/calculator/mortgage-calculator',
        sessions: 2000,
        engaged_sessions: 900,
        engagement_rate: 0.5621,
        average_session_duration_s: 88.3,
        page_views: 2200,
      })
      expect(r.totals.sessions).toBe(3200)
      expect(r.total_rows).toBe(43)
    }
  })

  it('linked property: revenue columns populated, revenue_per_1k_sessions derived, no warning', async () => {
    mockRunReport.mockResolvedValueOnce(LINKED)
    const r = await run({ property_id: '123456789' })
    if (!r.success) throw new Error('expected success')
    expect(r.rows[0].ad_revenue).toBe(4.54)
    expect(r.rows[0].ad_impressions).toBe(3000)
    expect(r.rows[0].revenue_per_1k_sessions).toBe(2.27) // 4.54 / 2000 * 1000
    expect(r.totals.revenue_per_1k_sessions).toBe(1.75)
    expect(r.warnings.some((w) => w.startsWith(AD_REVENUE_UNAVAILABLE))).toBe(false)
  })

  it('unlinked property: revenue columns present as 0 and ad_revenue_unavailable warning', async () => {
    mockRunReport.mockResolvedValueOnce(UNLINKED)
    const r = await run({ property_id: '1' })
    if (!r.success) throw new Error('expected success')
    expect(r.rows[0]).toMatchObject({ ad_revenue: 0, ad_impressions: 0, ad_clicks: 0, revenue_per_1k_sessions: 0 })
    expect(r.warnings.some((w) => w.startsWith(AD_REVENUE_UNAVAILABLE))).toBe(true)
  })

  it('order_by ad_revenue sorts on totalAdRevenue descending', async () => {
    mockRunReport.mockResolvedValueOnce(LINKED)
    await run({ property_id: '1', order_by: 'ad_revenue' })
    expect(mockRunReport.mock.calls[0][1]).toMatchObject({
      orderBys: [{ metric: { metricName: 'totalAdRevenue' }, desc: true }],
    })
  })

  it('rejects a Measurement ID without calling the API', async () => {
    const r = await run({ property_id: 'G-ABC123' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe(ErrorCode.INVALID_INPUT)
      expect(r.error.message).toContain('Measurement ID')
    }
    expect(mockRunReport).not.toHaveBeenCalled()
  })

  it('rejects a call with neither property_id nor config', async () => {
    const r = await run({})
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.code).toBe(ErrorCode.INVALID_INPUT)
  })

  it('passes an upstream AUTH_DENIED through with its hint', async () => {
    mockRunReport.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'denied', 'See mcp/PERMISSIONS.md'))
    const r = await run({ property_id: '1' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe(ErrorCode.AUTH_DENIED)
      expect(r.error.hint).toContain('PERMISSIONS.md')
    }
  })

  it('config input resolves the property via `ga4 config resolve`', async () => {
    executor.execute.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify([
        { path: 'configs/site.yaml', project: 'Site', property_id: '123456789', gsc_site: '', hreflang_pairs: [] },
      ]),
      stderr: '',
      duration: 1,
    })
    mockRunReport.mockResolvedValueOnce(LINKED)
    const r = await run({ config: 'configs/site.yaml' })
    expect(r.success).toBe(true)
    expect(executor.execute).toHaveBeenCalledWith({
      command: 'config',
      args: ['resolve', '--config', 'configs/site.yaml', '--format', 'json'],
    })
    expect(mockRunReport.mock.calls[0][0]).toBe('properties/123456789')
  })

  it('config without a property_id is INVALID_INPUT', async () => {
    executor.execute.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify([{ path: 'c.yaml', project: 'C', property_id: '', gsc_site: 'sc-domain:c.com', hreflang_pairs: [] }]),
      stderr: '',
      duration: 1,
    })
    const r = await run({ config: 'c.yaml' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.code).toBe(ErrorCode.INVALID_INPUT)
    expect(mockRunReport).not.toHaveBeenCalled()
  })

  it('a config the CLI cannot load is INVALID_INPUT with the CLI error', async () => {
    executor.execute.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'failed to load config: no such file', duration: 1 })
    const r = await run({ config: 'missing.yaml' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe(ErrorCode.INVALID_INPUT)
      expect(r.error.message).toContain('no such file')
    }
  })

  it('handles a response with no totals (empty window) as zeros', () => {
    expect(toTrafficMetrics(undefined)).toMatchObject({ sessions: 0, revenue_per_1k_sessions: 0 })
  })
})

describe('ga4TrafficReportTool definition', () => {
  it('is read-only', () => {
    expect(ga4TrafficReportTool.name).toBe('ga4_traffic_report')
    expect(ga4TrafficReportTool.annotations.readOnlyHint).toBe(true)
  })
})
