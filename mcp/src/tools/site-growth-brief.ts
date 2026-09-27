import { z } from 'zod'
import { native, isSuccessExit } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { runReport, type DataApiResponse } from '../utils/ga4-data-client.js'
import { resolveConfigs, type ResolvedConfig } from '../utils/config-resolve.js'
import { ToolError, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import { normalizeGa4Property } from '../utils/url-normalize.js'
import { querySearchAnalytics } from './gsc-traffic-compare.js'
import { buildOpportunitiesArgs, gscOpportunitiesInputSchema, parseOpportunitiesOutput } from './gsc-opportunities.js'
import { buildUrlHygieneArgs, gscUrlHygieneInputSchema, parseUrlHygieneOutput } from './gsc-url-hygiene.js'
import { buildCTRAnomalyArgs, gscCTRAnomalyInputSchema, parseCTRAnomalyOutput } from './gsc-ctr-anomaly.js'
import { buildHreflangArgs, gscHreflangInputSchema, parseHreflangOutput } from './gsc-hreflang.js'
import {
  EMPTY_KPIS,
  ctrAnomalyFinding,
  digestFindings,
  hreflangFinding,
  hygieneFinding,
  joinTopPages,
  kpiDeltas,
  opportunityFinding,
  sig4,
  type Finding,
  type Ga4PageMetrics,
  type GscPageMetrics,
  type Kpis,
  type TopPage,
} from './compute-growth-brief.js'

// ============================================================================
// Input Schema
// ============================================================================

export const siteGrowthBriefInputSchema = z.object({
  config: z.string().min(1).optional().describe('Path to one YAML config. Alternative to all.'),
  all: z.boolean().optional().describe('Brief every operator config under configs/*.yaml (examples excluded).'),
  days: z
    .number()
    .int()
    .min(7)
    .max(240)
    .optional()
    .default(28)
    .describe('Window length in days; deltas compare against the preceding window of the same length (default 28).'),
})

export type SiteGrowthBriefInput = z.infer<typeof siteGrowthBriefInputSchema>

// ============================================================================
// Result Types
// ============================================================================

export interface DataGap {
  source: string
  reason: string
}

interface Window {
  start: string
  end: string
}

export interface SiteBrief {
  site: { project: string; config: string; gsc_site: string | null; property_id: string | null }
  /** "YYYY-MM-DD/YYYY-MM-DD" (ISO 8601 interval) per source and window. */
  windows: { gsc: { current: string; previous: string }; ga4: { current: string; previous: string } }
  kpis: Kpis
  deltas: Record<keyof Kpis, number | null>
  top_pages: TopPage[]
  findings: Finding[]
  data_gaps: DataGap[]
}

export type SiteGrowthBriefResult =
  | {
      success: true
      warnings: string[]
      generated_at: string
      days: number
      briefs: SiteBrief[]
      quota_used: { gsc: number; ga4_data: number }
    }
  | ToolFailureResult

// ============================================================================
// Windows
// ============================================================================

const DAY_MS = 86_400_000
/** GSC data lags ~2–3 days; ending the window 3 days ago avoids partial days. */
const GSC_LAG_DAYS = 3
const GA4_LAG_DAYS = 1
const DIAGNOSTIC_TIMEOUT_MS = 180_000

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export function briefWindows(now: Date, days: number, lagDays: number): { current: Window; previous: Window } {
  const end = new Date(now.getTime() - lagDays * DAY_MS)
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  const prevEnd = new Date(start.getTime() - DAY_MS)
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY_MS)
  return {
    current: { start: ymd(start), end: ymd(end) },
    previous: { start: ymd(prevStart), end: ymd(prevEnd) },
  }
}

const intervals = (w: { current: Window; previous: Window }) => ({
  current: `${w.current.start}/${w.current.end}`,
  previous: `${w.previous.start}/${w.previous.end}`,
})

// ============================================================================
// Per-source collectors
// ============================================================================

function gapReason(err: unknown): string {
  if (err instanceof ToolError) return err.code
  return err instanceof Error ? err.message.slice(0, 120) : String(err)
}

interface GscCollected {
  current: Pick<Kpis, 'gsc_clicks' | 'gsc_impressions' | 'gsc_ctr' | 'gsc_position'>
  previous: Pick<Kpis, 'gsc_clicks' | 'gsc_impressions' | 'gsc_ctr' | 'gsc_position'>
  pages: GscPageMetrics[]
}

async function collectGsc(site: string, windows: { current: Window; previous: Window }): Promise<GscCollected> {
  // Dimensionless queries return the property-level aggregate (summing page
  // rows would double-count impressions shared across pages).
  const [cur, prev, pages] = await Promise.all([
    querySearchAnalytics(site, windows.current.start, windows.current.end, [], 1),
    querySearchAnalytics(site, windows.previous.start, windows.previous.end, [], 1),
    querySearchAnalytics(site, windows.current.start, windows.current.end, ['page'], 1000),
  ])
  const totals = (rows: typeof cur) => {
    const r = rows[0]
    return r
      ? { gsc_clicks: r.clicks, gsc_impressions: r.impressions, gsc_ctr: sig4(r.ctr), gsc_position: sig4(r.position) }
      : { gsc_clicks: 0, gsc_impressions: 0, gsc_ctr: 0, gsc_position: null }
  }
  return {
    current: totals(cur),
    previous: totals(prev),
    pages: pages.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
  }
}

interface Ga4Collected {
  current: Pick<Kpis, 'sessions' | 'engagement_rate' | 'ad_revenue' | 'revenue_per_1k_sessions'>
  previous: Pick<Kpis, 'sessions' | 'engagement_rate' | 'ad_revenue' | 'revenue_per_1k_sessions'>
  pages: Ga4PageMetrics[]
  adImpressions: number
}

async function collectGa4(propertyId: string, windows: { current: Window; previous: Window }): Promise<Ga4Collected> {
  const data: DataApiResponse = await runReport(propertyId, {
    dateRanges: [
      { startDate: windows.current.start, endDate: windows.current.end, name: 'current' },
      { startDate: windows.previous.start, endDate: windows.previous.end, name: 'previous' },
    ],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'totalAdRevenue' },
      { name: 'publisherAdImpressions' },
    ],
    metricAggregations: ['TOTAL'],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 1000,
  })

  const num = (v: { value: string }[] | undefined, i: number) => Number(v?.[i]?.value ?? 0) || 0
  const totalsFor = (name: string) => {
    const row = data.totals?.find((t) => t.dimensionValues?.some((d) => d.value === name))
    const sessions = num(row?.metricValues, 0)
    const revenue = num(row?.metricValues, 2)
    return {
      kpis: {
        sessions,
        engagement_rate: sig4(num(row?.metricValues, 1)),
        ad_revenue: sig4(revenue),
        revenue_per_1k_sessions: sessions > 0 ? sig4((revenue / sessions) * 1000) : 0,
      },
      adImpressions: num(row?.metricValues, 3),
    }
  }

  const current = totalsFor('current')
  const pages: Ga4PageMetrics[] = (data.rows ?? [])
    .filter((r) => r.dimensionValues?.[1]?.value === 'current')
    .map((r) => ({
      pagePath: r.dimensionValues[0].value,
      sessions: num(r.metricValues, 0),
      ad_revenue: num(r.metricValues, 2),
    }))

  return { current: current.kpis, previous: totalsFor('previous').kpis, pages, adImpressions: current.adImpressions }
}

interface DiagnosticsCollected {
  findings: Finding[]
  quota: number
  gaps: DataGap[]
}

async function collectDiagnostics(executor: CLIExecutor, cfg: ResolvedConfig, days: number): Promise<DiagnosticsCollected> {
  const run = async <T extends { quota_used: number }>(args: string[], parse: (s: string) => T): Promise<T> => {
    const result = await executor.execute({ command: 'gsc', args, timeout: DIAGNOSTIC_TIMEOUT_MS })
    if (!isSuccessExit(result.exitCode)) {
      throw new Error((result.stderr || result.stdout).trim().split('\n').pop() ?? `exit ${result.exitCode}`)
    }
    return parse(result.stdout)
  }

  const jobs: [string, () => Promise<{ findings: Finding[]; quota: number }>][] = [
    [
      'opportunities',
      async () => {
        const out = await run(
          buildOpportunitiesArgs(gscOpportunitiesInputSchema.parse({ config: cfg.path, days, granularity: 'page' })),
          parseOpportunitiesOutput,
        )
        return { findings: out.results.map(opportunityFinding), quota: out.quota_used }
      },
    ],
    [
      'ctr_anomaly',
      async () => {
        const out = await run(buildCTRAnomalyArgs(gscCTRAnomalyInputSchema.parse({ config: cfg.path, days })), parseCTRAnomalyOutput)
        return { findings: out.results.map(ctrAnomalyFinding), quota: out.quota_used }
      },
    ],
    [
      'url_hygiene',
      async () => {
        const out = await run(buildUrlHygieneArgs(gscUrlHygieneInputSchema.parse({ config: cfg.path })), parseUrlHygieneOutput)
        return {
          findings: out.results.filter((r) => r.severity === 'warning').map(hygieneFinding),
          quota: out.quota_used,
        }
      },
    ],
  ]
  // Hreflang only with declared pairs: discovery fetches up to 50 pages,
  // too slow and too broad for a brief.
  if (cfg.hreflang_pairs.length > 0) {
    jobs.push([
      'hreflang',
      async () => {
        const out = await run(buildHreflangArgs(gscHreflangInputSchema.parse({ config: cfg.path, days })), parseHreflangOutput)
        return {
          findings: out.results.filter((r) => r.severity === 'warning').map(hreflangFinding),
          quota: out.quota_used,
        }
      },
    ])
  }

  const settled = await Promise.allSettled(jobs.map(([, job]) => job()))
  const collected: DiagnosticsCollected = { findings: [], quota: 0, gaps: [] }
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      collected.findings.push(...s.value.findings)
      collected.quota += s.value.quota
    } else {
      collected.gaps.push({ source: jobs[i][0], reason: gapReason(s.reason) })
    }
  })
  return collected
}

// ============================================================================
// Brief assembly
// ============================================================================

interface SiteOutcome {
  brief: SiteBrief
  primaryFailed: boolean
  quota: { gsc: number; ga4_data: number }
}

async function briefSite(executor: CLIExecutor, cfg: ResolvedConfig, days: number, now: Date): Promise<SiteOutcome> {
  const gscWindows = briefWindows(now, days, GSC_LAG_DAYS)
  const ga4Windows = briefWindows(now, days, GA4_LAG_DAYS)
  const gaps: DataGap[] = []
  const quota = { gsc: 0, ga4_data: 0 }

  let propertyId: string | null = null
  if (cfg.property_id) {
    try {
      propertyId = normalizeGa4Property(cfg.property_id)
    } catch (err) {
      gaps.push({ source: 'ga4', reason: gapReason(err) })
    }
  } else {
    gaps.push({ source: 'ga4', reason: 'not_configured' })
  }
  if (!cfg.gsc_site) gaps.push({ source: 'gsc', reason: 'not_configured' })

  const [gsc, ga4, diagnostics] = await Promise.allSettled([
    cfg.gsc_site ? collectGsc(cfg.gsc_site, gscWindows) : Promise.resolve(null),
    propertyId ? collectGa4(propertyId, ga4Windows) : Promise.resolve(null),
    cfg.gsc_site ? collectDiagnostics(executor, cfg, days) : Promise.resolve(null),
  ])

  const current: Kpis = { ...EMPTY_KPIS }
  const previous: Kpis = { ...EMPTY_KPIS }
  let gscPages: GscPageMetrics[] = []
  let ga4Pages: Ga4PageMetrics[] = []
  let gscOk = false
  let ga4Ok = false

  if (gsc.status === 'fulfilled' && gsc.value) {
    Object.assign(current, gsc.value.current)
    Object.assign(previous, gsc.value.previous)
    gscPages = gsc.value.pages
    quota.gsc += 3
    gscOk = true
  } else if (gsc.status === 'rejected') {
    gaps.push({ source: 'gsc', reason: gapReason(gsc.reason) })
  }

  if (ga4.status === 'fulfilled' && ga4.value) {
    Object.assign(current, ga4.value.current)
    Object.assign(previous, ga4.value.previous)
    ga4Pages = ga4.value.pages
    quota.ga4_data += 1
    ga4Ok = true
    if (ga4.value.adImpressions === 0) gaps.push({ source: 'ga4_ad_revenue', reason: 'ad_revenue_unavailable' })
  } else if (ga4.status === 'rejected') {
    gaps.push({ source: 'ga4', reason: gapReason(ga4.reason) })
  }

  let findings: Finding[] = []
  if (diagnostics.status === 'fulfilled' && diagnostics.value) {
    findings = digestFindings(diagnostics.value.findings)
    quota.gsc += diagnostics.value.quota
    gaps.push(...diagnostics.value.gaps)
  } else if (diagnostics.status === 'rejected') {
    gaps.push({ source: 'diagnostics', reason: gapReason(diagnostics.reason) })
  }

  return {
    brief: {
      site: {
        project: cfg.project,
        config: cfg.path,
        gsc_site: cfg.gsc_site || null,
        property_id: propertyId,
      },
      windows: { gsc: intervals(gscWindows), ga4: intervals(ga4Windows) },
      kpis: current,
      deltas: kpiDeltas(current, previous),
      top_pages: joinTopPages(gscPages, ga4Pages),
      findings,
      data_gaps: gaps,
    },
    primaryFailed: !gscOk && !ga4Ok,
    quota,
  }
}

export async function runSiteGrowthBrief(
  input: SiteGrowthBriefInput,
  executor: CLIExecutor,
  now: Date = new Date(),
): Promise<SiteGrowthBriefResult> {
  if (!input.config && !input.all) {
    return {
      success: false,
      error: { code: ErrorCode.INVALID_INPUT, message: 'Provide either config or all: true.' },
    }
  }

  let configs: ResolvedConfig[]
  try {
    configs = await resolveConfigs(executor, input.config ? { config: input.config } : { all: true })
  } catch (err) {
    const e = err instanceof ToolError ? err : new ToolError(ErrorCode.UPSTREAM_5XX, String(err))
    return { success: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } }
  }
  if (configs.length === 0) {
    return {
      success: false,
      error: { code: ErrorCode.NOT_FOUND, message: 'No operator configs found under configs/*.yaml.' },
    }
  }

  const outcomes = await Promise.all(configs.map((cfg) => briefSite(executor, cfg, input.days, now)))

  if (outcomes.every((o) => o.primaryFailed)) {
    const reasons = outcomes.flatMap((o) => o.brief.data_gaps.map((g) => `${o.brief.site.project}/${g.source}: ${g.reason}`))
    return {
      success: false,
      error: {
        code: ErrorCode.UPSTREAM_5XX,
        message: `Every data source failed for every site: ${reasons.join('; ')}`,
        hint: 'Check credentials and scopes (mcp/PERMISSIONS.md) and that configs set ga4.property_id / search_console.site_url.',
      },
    }
  }

  const briefs = outcomes
    .map((o) => o.brief)
    .sort(
      (a, b) =>
        (b.kpis.ad_revenue ?? -1) - (a.kpis.ad_revenue ?? -1) ||
        (b.kpis.gsc_clicks ?? -1) - (a.kpis.gsc_clicks ?? -1),
    )
  const warnings = briefs
    .filter((b) => b.data_gaps.length > 0)
    .map((b) => `${b.site.project}: partial data (${b.data_gaps.map((g) => g.source).join(', ')})`)

  return {
    success: true,
    warnings,
    generated_at: now.toISOString(),
    days: input.days,
    briefs,
    quota_used: outcomes.reduce(
      (acc, o) => ({ gsc: acc.gsc + o.quota.gsc, ga4_data: acc.ga4_data + o.quota.ga4_data }),
      { gsc: 0, ga4_data: 0 },
    ),
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const siteGrowthBriefTool = {
  name: 'site_growth_brief',
  description:
    'Use first when the user wants a plan to grow SEO traffic or ad/passive revenue for their site(s), or asks "how are my sites doing". ' +
    'Returns one compact brief per site joining Search Console, GA4 traffic and AdSense-in-GA4 revenue: ' +
    'kpis (GSC clicks/impressions/CTR/position, sessions, engagement rate, ad revenue, revenue per 1k sessions), ' +
    'deltas vs the preceding window (%), top_pages (GSC clicks + sessions + ad revenue per page, ranked by revenue), ' +
    'findings (top 10 from page-level opportunities, CTR anomalies, URL-hygiene warnings and — when hreflang_pairs are configured — hreflang warnings, ranked by estimated clicks), ' +
    'and data_gaps naming any source that was missing or failed. ' +
    'Finding actions by source: opportunities → rewrite title/meta for the page; ctr_anomaly → refresh the snippet for that query; url_hygiene → keep the URL out of the index; hreflang → fix annotations so the right-language page ranks. ' +
    'Pass config for one site or all=true for every configs/*.yaml. Revenue is GA4-attributed (use adsense_report for payout figures). ' +
    'Drill into a finding with gsc_opportunities, gsc_url_hygiene, gsc_hreflang or ga4_traffic_report. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      config: { type: 'string', description: 'Path to one YAML config. Alternative to all.' },
      all: { type: 'boolean', description: 'Brief every operator config under configs/*.yaml (examples excluded).' },
      days: {
        type: 'number',
        minimum: 7,
        maximum: 240,
        default: 28,
        description: 'Window length in days; deltas compare with the preceding window of equal length. Default 28.',
      },
    },
  },
  annotations: { title: 'Site growth brief', readOnlyHint: true, openWorldHint: true },
}

export const siteGrowthBriefSpec = native({
  tool: siteGrowthBriefTool,
  schema: siteGrowthBriefInputSchema,
  run: async (input, executor) => {
    const output = await runSiteGrowthBrief(input, executor)
    return { output, isError: !output.success }
  },
})
