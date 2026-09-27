import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReport } from '../utils/ga4-data-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import type { CLIExecutor } from '../cli/executor.js'
import { querySearchAnalytics } from './gsc-traffic-compare.js'
import { briefWindows, runSiteGrowthBrief, siteGrowthBriefInputSchema } from './site-growth-brief.js'

vi.mock('../utils/ga4-data-client.js', () => ({ runReport: vi.fn() }))
vi.mock('./gsc-traffic-compare.js', () => ({ querySearchAnalytics: vi.fn() }))

const mockRunReport = vi.mocked(runReport)
const mockGsc = vi.mocked(querySearchAnalytics)

const NOW = new Date('2026-09-27T12:00:00Z')

const SITE = {
  path: 'configs/mysite.yaml',
  project: 'ExampleSite',
  property_id: '123456789',
  gsc_site: 'sc-domain:example.com',
  hreflang_pairs: [] as Record<string, string>[],
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function gscRow(keys: string[], clicks: number, impressions: number, ctr = 0, position = 0) {
  return { keys, clicks, impressions, ctr, position }
}

function stubGsc(opts: { fail?: boolean } = {}) {
  mockGsc.mockImplementation(async (_site, start, _end, dims) => {
    if (opts.fail) throw new ToolError(ErrorCode.AUTH_DENIED, 'GSC access denied (HTTP 403)')
    if (dims.length === 0) {
      return start === '2026-08-28'
        ? [gscRow([], 800, 90000, 0.0089, 17.5)] // current window
        : [gscRow([], 600, 80000, 0.0075, 18.0)] // previous window
    }
    return [
      gscRow(['https://www.example.com/calculator/mortgage-calculator'], 400, 70000),
      gscRow(['https://www.example.com/blog/post#section'], 0, 10),
      gscRow(['https://www.example.com/blog/post'], 9, 1300),
    ]
  })
}

const mv = (...values: number[]) => values.map((v) => ({ value: String(v) }))

function ga4Response(adImpressions: number) {
  return {
    rows: [
      { dimensionValues: [{ value: '/calculator/mortgage-calculator' }, { value: 'current' }], metricValues: mv(600, 0.91, 1.2, 1100) },
      { dimensionValues: [{ value: '/blog/post' }, { value: 'current' }], metricValues: mv(30, 0.8, 0.05, 40) },
      { dimensionValues: [{ value: '/calculator/mortgage-calculator' }, { value: 'previous' }], metricValues: mv(500, 0.9, 1.0, 900) },
    ],
    totals: [
      { dimensionValues: [{ value: 'RESERVED_TOTAL' }, { value: 'current' }], metricValues: mv(1000, 0.85, adImpressions ? 2 : 0, adImpressions) },
      { dimensionValues: [{ value: 'RESERVED_TOTAL' }, { value: 'previous' }], metricValues: mv(800, 0.8, adImpressions ? 1.6 : 0, adImpressions) },
    ],
  }
}

const OPPORTUNITIES = JSON.stringify({
  command: 'gsc_opportunities',
  site: 'sc-domain:example.com',
  generated_at: 'x',
  results: [
    { query: '', page: 'https://www.example.com/blog/post', position: 7.3, clicks: 9, impressions: 1300, ctr: 0.0069, bucket: 7, category_median_ctr: 0.045, median_source: 'baseline', ctr_gap: 0.038, potential_clicks: 50 },
    { query: '', page: 'https://www.example.com/calculator/mortgage-calculator', position: 8.7, clicks: 400, impressions: 70000, ctr: 0.0057, bucket: 9, category_median_ctr: 0.035, median_source: 'baseline', ctr_gap: 0.029, potential_clicks: 2050, anonymized_share: 0.8 },
  ],
  quota_used: 2,
})
const CTR_ANOMALY = JSON.stringify({ command: 'gsc_ctr_anomaly', site: 's', generated_at: 'x', results: [], quota_used: 2 })
const HYGIENE = JSON.stringify({
  command: 'gsc_url_hygiene',
  site: 's',
  generated_at: 'x',
  results: [
    { url: 'https://www.example.com/blog/post#section', issue: 'fragment', severity: 'warning', impressions: 10, clicks: 0, fix: 'f' },
    { url: 'https://www.example.com/privacy', issue: 'utility_page', severity: 'info', impressions: 21, clicks: 0, fix: 'f' },
  ],
  quota_used: 1,
})

type Exec = CLIExecutor & { execute: ReturnType<typeof vi.fn> }

function makeExecutor(configs: object[], overrides: Record<string, { exitCode: number; stdout: string; stderr?: string }> = {}): Exec {
  const execute = vi.fn(async ({ command, args }: { command: string; args: string[] }) => {
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', duration: 1 })
    if (command === 'config') return ok(JSON.stringify(configs))
    const sub = args[0]
    if (overrides[sub]) return { stderr: '', duration: 1, ...overrides[sub] }
    if (sub === 'opportunities') return { ...ok(OPPORTUNITIES), exitCode: 2 }
    if (sub === 'ctr-anomaly') return ok(CTR_ANOMALY)
    if (sub === 'url-hygiene') return { ...ok(HYGIENE), exitCode: 2 }
    throw new Error(`unexpected ${command} ${args.join(' ')}`)
  })
  return { execute } as unknown as Exec
}

beforeEach(() => {
  mockRunReport.mockReset()
  mockGsc.mockReset()
})

const run = (raw: Record<string, unknown>, executor: Exec) =>
  runSiteGrowthBrief(siteGrowthBriefInputSchema.parse(raw), executor, NOW)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('briefWindows', () => {
  it('ends lagDays ago and places the previous window immediately before', () => {
    expect(briefWindows(NOW, 28, 3)).toEqual({
      current: { start: '2026-08-28', end: '2026-09-24' },
      previous: { start: '2026-07-31', end: '2026-08-27' },
    })
  })
})

describe('runSiteGrowthBrief', () => {
  it('single site: all sections populated from GSC, GA4 and diagnostics', async () => {
    stubGsc()
    mockRunReport.mockResolvedValueOnce(ga4Response(5000))
    const r = await run({ config: SITE.path }, makeExecutor([SITE]))
    if (!r.success) throw new Error(JSON.stringify(r))

    expect(r.briefs).toHaveLength(1)
    const b = r.briefs[0]
    expect(b.kpis).toMatchObject({ gsc_clicks: 800, sessions: 1000, ad_revenue: 2, revenue_per_1k_sessions: 2 })
    expect(b.deltas.gsc_clicks).toBeCloseTo(33.3333, 3)
    expect(b.deltas.sessions).toBe(25)
    expect(b.top_pages[0]).toMatchObject({ path: '/calculator/mortgage-calculator', gsc_clicks: 400, sessions: 600, ad_revenue: 1.2 })
    // Fragment variant folded into /blog/post.
    expect(b.top_pages.find((p) => p.path === '/blog/post')).toMatchObject({ gsc_clicks: 9, gsc_impressions: 1310 })
    // Biggest opportunity first, info-only hygiene excluded, null impact last.
    expect(b.findings.map((f) => f.source)).toEqual(['opportunities', 'opportunities', 'url_hygiene'])
    expect(b.findings[0].page).toBe('/calculator/mortgage-calculator')
    expect(b.findings[2].impact).toBeNull()
    expect(b.data_gaps).toEqual([])
    expect(r.quota_used).toEqual({ gsc: 3 + 2 + 2 + 1, ga4_data: 1 })
  })

  it('never runs hreflang without declared pairs, runs it with them', async () => {
    stubGsc()
    mockRunReport.mockResolvedValue(ga4Response(5000))
    const noPairs = makeExecutor([SITE])
    await run({ config: SITE.path }, noPairs)
    expect(noPairs.execute.mock.calls.some(([p]) => p.args?.[0] === 'hreflang')).toBe(false)

    const withPairs = makeExecutor([{ ...SITE, hreflang_pairs: [{ en: 'https://www.example.com/a', es: 'https://www.example.com/b' }] }], {
      hreflang: {
        exitCode: 2,
        stdout: JSON.stringify({
          command: 'gsc_hreflang', site: 's', generated_at: 'x', pages_fetched: 2, quota_used: 1,
          results: [{ page: 'https://www.example.com/b', issue: 'cross_language_ranking', severity: 'warning', detail: 'd', query: 'mortgage payment simulator', expected_page: 'https://www.example.com/a', impressions: 29 }],
        }),
      },
    })
    const r = await run({ config: SITE.path }, withPairs)
    if (!r.success) throw new Error('expected success')
    expect(r.briefs[0].findings.some((f) => f.source === 'hreflang')).toBe(true)
  })

  it('AdSense not linked: revenue 0 and ga4_ad_revenue gap', async () => {
    stubGsc()
    mockRunReport.mockResolvedValueOnce(ga4Response(0))
    const r = await run({ config: SITE.path }, makeExecutor([SITE]))
    if (!r.success) throw new Error('expected success')
    expect(r.briefs[0].kpis.ad_revenue).toBe(0)
    expect(r.briefs[0].data_gaps).toContainEqual({ source: 'ga4_ad_revenue', reason: 'ad_revenue_unavailable' })
    expect(r.warnings[0]).toContain('partial data')
  })

  it('config without GSC: GSC KPIs null, gsc not_configured gap, no diagnostics run', async () => {
    mockRunReport.mockResolvedValueOnce(ga4Response(5000))
    const exec = makeExecutor([{ ...SITE, gsc_site: '' }])
    const r = await run({ config: SITE.path }, exec)
    if (!r.success) throw new Error('expected success')
    expect(r.briefs[0].kpis.gsc_clicks).toBeNull()
    expect(r.briefs[0].data_gaps).toContainEqual({ source: 'gsc', reason: 'not_configured' })
    expect(mockGsc).not.toHaveBeenCalled()
    expect(exec.execute.mock.calls.every(([p]) => p.command === 'config')).toBe(true)
  })

  it('one diagnostic failing becomes a data gap, not a failure', async () => {
    stubGsc()
    mockRunReport.mockResolvedValueOnce(ga4Response(5000))
    const r = await run(
      { config: SITE.path },
      makeExecutor([SITE], { 'ctr-anomaly': { exitCode: 1, stdout: '', stderr: 'search analytics query failed: quota' } }),
    )
    if (!r.success) throw new Error('expected success')
    expect(r.briefs[0].data_gaps).toContainEqual({ source: 'ctr_anomaly', reason: 'search analytics query failed: quota' })
    expect(r.briefs[0].findings.length).toBeGreaterThan(0)
  })

  it('every source failing for every site is a failure', async () => {
    stubGsc({ fail: true })
    mockRunReport.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'denied'))
    const r = await run(
      { config: SITE.path },
      makeExecutor([SITE], {
        opportunities: { exitCode: 1, stdout: '', stderr: 'x' },
        'ctr-anomaly': { exitCode: 1, stdout: '', stderr: 'x' },
        'url-hygiene': { exitCode: 1, stdout: '', stderr: 'x' },
      }),
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.message).toContain('ExampleSite/gsc: AUTH_DENIED')
  })

  it('all: true briefs every config, sorted by ad revenue then clicks', async () => {
    stubGsc()
    mockRunReport.mockImplementation(async (propertyId) =>
      propertyId === 'properties/123456789' ? ga4Response(5000) : ga4Response(0),
    )
    const snap = { path: 'configs/othersite.yaml', project: 'OtherSite', property_id: '987654321', gsc_site: 'sc-domain:other.example', hreflang_pairs: [] }
    const exec = makeExecutor([snap, SITE])
    const r = await run({ all: true }, exec)
    if (!r.success) throw new Error('expected success')
    expect(r.briefs.map((b) => b.site.project)).toEqual(['ExampleSite', 'OtherSite'])
    expect(exec.execute.mock.calls[0][0].args).toEqual(['resolve', '--all', '--format', 'json'])
  })

  it('requires config or all', async () => {
    const r = await run({}, makeExecutor([]))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.code).toBe(ErrorCode.INVALID_INPUT)
  })
})

describe('size budget', () => {
  it('a fully populated brief serializes to ≤ 4 KB', async () => {
    const longPath = (i: number) => `/blog/a-fairly-long-article-slug-about-index-investing-number-${i}`
    mockGsc.mockImplementation(async (_s, start, _e, dims) =>
      dims.length === 0
        ? [gscRow([], start === '2026-08-28' ? 81234 : 70123, 9_876_543, 0.00823, 12.34)]
        : Array.from({ length: 40 }, (_, i) => gscRow([`https://www.example.com${longPath(i)}`], 1000 - i, 50000 - i)),
    )
    mockRunReport.mockResolvedValueOnce({
      rows: Array.from({ length: 40 }, (_, i) => ({
        dimensionValues: [{ value: longPath(i) }, { value: 'current' }],
        metricValues: mv(5000 - i, 0.912345, 12.345678 - i / 10, 9000),
      })),
      totals: ga4Response(5000).totals,
    })
    const manyOpps = JSON.stringify({
      command: 'gsc_opportunities', site: 's', generated_at: 'x', quota_used: 2,
      results: Array.from({ length: 25 }, (_, i) => ({
        query: '', page: `https://www.example.com${longPath(i)}`, position: 8.123, clicks: 10, impressions: 90000,
        ctr: 0.00512, bucket: 8, category_median_ctr: 0.04, median_source: 'baseline', ctr_gap: 0.035, potential_clicks: 3000 - i,
        anonymized_share: 0.87,
      })),
    })
    const exec = makeExecutor([SITE], { opportunities: { exitCode: 2, stdout: manyOpps } })
    const r = await run({ config: SITE.path }, exec)
    if (!r.success) throw new Error('expected success')

    const b = r.briefs[0]
    expect(b.top_pages).toHaveLength(10)
    expect(b.findings).toHaveLength(10)
    const bytes = Buffer.byteLength(JSON.stringify(b))
    expect(bytes).toBeLessThanOrEqual(4096)
  })
})
