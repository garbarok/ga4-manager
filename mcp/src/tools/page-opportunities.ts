import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { querySearchAnalytics } from './gsc-traffic-compare.js'
import { runReport } from '../utils/ga4-data-client.js'
import { getPropertySettings, GSC_TIME_ZONE } from '../utils/ga4-admin-client.js'
import { gscDataThrough } from '../utils/gsc-data-through.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import { normalizeGa4Property, normalizeGscSite } from '../utils/url-normalize.js'
import { setContextSite } from '../utils/tool-context.js'
import { ORGANIC_FILTER } from './ga4-organic-shared.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import { scoreOpportunities, zoneOffsetHours, type Ga4LandingRow, type GscPageRow, type PageOpportunity, type Coverage, type BusinessValueBasis } from './compute-page-opportunities.js'

// ============================================================================
// Input Schema
// ============================================================================

export const pageOpportunitiesInputSchema = z
  .object({
    config: z.string().min(1).optional().describe('YAML config with search_console.site_url and ga4.property_id'),
    site: z.string().min(1).optional().describe('GSC site (sc-domain:example.com or https://example.com/); with property_id instead of config'),
    property_id: z.string().min(1).optional().describe('GA4 property ID (numeric or properties/N)'),
    days: z.number().int().min(7).max(180).optional().default(28),
    min_position: z.number().min(1).max(100).optional().default(4),
    max_position: z.number().min(1).max(100).optional().default(20),
    min_impressions: z.number().int().min(0).optional().default(50),
    limit: z.number().int().min(1).max(500).optional().default(50),
    gsc_row_limit: z.number().int().min(100).max(25_000).optional().default(5000),
  })
  .refine((d) => d.config || (d.site && d.property_id), { message: 'Pass config, or both site and property_id' })
  .refine((d) => d.min_position <= d.max_position, { message: 'min_position must be <= max_position' })

export type PageOpportunitiesInput = z.infer<typeof pageOpportunitiesInputSchema>

// ============================================================================
// Output
// ============================================================================

export type PageOpportunitiesResult =
  | {
      success: true
      site: string
      property_id: string
      window: { start: string; end: string; days: number }
      data_through: string | null
      formula: string
      business_value_basis: BusinessValueBasis
      coverage: Coverage
      opportunities: PageOpportunity[]
      truncated: boolean
      warnings: string[]
      quota_used: { gsc: number; ga4: number }
    }
  | ToolFailureResult

const DAY_MS = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * The window both sources read: `days` ending at the last date Search Console
 * has data for (else three days ago, its usual lag), so GSC and GA4 cover the
 * same calendar days.
 */
export function joinWindow(days: number, dataThrough: string | null, now: Date = new Date()): { start: string; end: string } {
  const endMs = dataThrough ? Date.parse(`${dataThrough}T00:00:00Z`) : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 3 * DAY_MS
  return { start: iso(endMs - (days - 1) * DAY_MS), end: iso(endMs) }
}

export async function runPageOpportunities(input: PageOpportunitiesInput, executor: CLIExecutor, now: Date = new Date()): Promise<PageOpportunitiesResult> {
  try {
    let site = input.site
    let propertyId = input.property_id
    if (input.config) {
      const [cfg] = await resolveConfigs(executor, { config: input.config })
      site = site ?? cfg?.gsc_site
      propertyId = propertyId ?? cfg?.property_id
    }
    if (!site) throw new ToolError(ErrorCode.INVALID_INPUT, 'No Search Console site: set search_console.site_url in the config or pass site.')
    if (!propertyId) throw new ToolError(ErrorCode.INVALID_INPUT, 'No GA4 property: set ga4.property_id in the config or pass property_id.')
    const warnings: string[] = []
    const norm = normalizeGscSite(site)
    site = norm.site
    if (norm.warning) warnings.push(norm.warning)
    setContextSite(site)
    const property = normalizeGa4Property(propertyId)

    const dataThrough = await gscDataThrough(site, now)
    const window = joinWindow(input.days, dataThrough, now)
    if (!dataThrough) warnings.push('Could not read the last Search Console data date; the window ends three days ago.')

    const [gscRows, ga4Report, settings] = await Promise.all([
      querySearchAnalytics(site, window.start, window.end, ['page'], input.gsc_row_limit),
      runReport(property, {
        dateRanges: [{ startDate: window.start, endDate: window.end }],
        dimensions: [{ name: 'landingPage' }],
        metrics: ['sessions', 'engagedSessions', 'engagementRate', 'keyEvents', 'sessionKeyEventRate', 'totalRevenue'].map((name) => ({ name })),
        dimensionFilter: ORGANIC_FILTER,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10_000,
      }),
      getPropertySettings(property).catch(() => null),
    ])

    const gsc: GscPageRow[] = gscRows.map((r) => ({ page: r.keys[0] ?? '', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
    const n = (v: string | undefined): number => {
      const x = Number(v)
      return Number.isFinite(x) ? x : 0
    }
    const ga4: Ga4LandingRow[] = (ga4Report.rows ?? [])
      .filter((r) => r.dimensionValues[0]?.value && r.dimensionValues[0].value !== '(not set)')
      .map((r) => ({
        landing_page: r.dimensionValues[0].value,
        sessions: n(r.metricValues[0]?.value),
        engaged_sessions: n(r.metricValues[1]?.value),
        engagement_rate: n(r.metricValues[2]?.value),
        key_events: n(r.metricValues[3]?.value),
        session_key_event_rate: n(r.metricValues[4]?.value),
        revenue: n(r.metricValues[5]?.value),
      }))

    if (gscRows.length >= input.gsc_row_limit) {
      warnings.push(`Search Console returned the full ${input.gsc_row_limit}-row limit; lower-traffic pages may be missing. Raise gsc_row_limit.`)
    }
    if (settings?.time_zone && settings.time_zone !== GSC_TIME_ZONE) {
      const diff = zoneOffsetHours(GSC_TIME_ZONE, settings.time_zone, now)
      warnings.push(
        `Time zones differ: the GA4 property reports in ${settings.time_zone}, Search Console in Pacific Time (${GSC_TIME_ZONE})` +
          `${diff !== null ? `, ${Math.abs(diff)} h apart` : ''}. Daily boundaries do not line up exactly; compare windows of a week or more.`,
      )
    }

    const scored = scoreOpportunities(gsc, ga4, input)
    return {
      success: true,
      site,
      property_id: property,
      window: { ...window, days: input.days },
      data_through: dataThrough,
      formula: 'score = round(100 × (0.5 demand + 0.3 business_value + 0.2 reachability)); demand = log impressions vs the largest candidate; business_value = session key-event rate (engagement rate when no key events), shrunk toward the site average with a 10-session prior, vs the best matched page; reachability = 1 at min_position, 0 at max_position',
      business_value_basis: scored.business_value_basis,
      coverage: scored.coverage,
      opportunities: scored.opportunities.slice(0, input.limit),
      truncated: scored.opportunities.length > input.limit,
      warnings: [...warnings, ...scored.warnings],
      quota_used: { gsc: dataThrough === null ? 1 : 2, ga4: 1 },
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const pageOpportunitiesTool = {
  name: 'page_opportunities',
  description:
    'Use to decide which pages to improve first: joins Search Console pages ranking in a position band (default 4–20, min_impressions 50) with their GA4 Organic Search ' +
    'landing-page outcomes over the same days, and scores each 0–100 = 0.5 demand (impressions) + 0.3 business value (session key-event rate, or engagement rate when the ' +
    'property has no key events) + 0.2 reachability (closer to the top of the band scores higher). Pages with no GA4 match stay in the list, unscored, with the reason. ' +
    'Returns coverage (rows considered, matched, unmatched), potential_clicks at position-3 CTR, data_through, and warnings such as "GA4 has no organic landing pages" or "time zones differ". ' +
    'Free: 2 Search Console queries + 1 GA4 report. Input: config (site + property), or site + property_id.',
  inputSchema: {
    type: 'object',
    properties: {
      config: { type: 'string', description: 'YAML config with search_console.site_url and ga4.property_id' },
      site: { type: 'string', description: 'GSC site (sc-domain:example.com or https://example.com/), with property_id' },
      property_id: { type: 'string', description: 'GA4 property ID (numeric or properties/N)' },
      days: { type: 'number', description: 'Window length in days, ending at data_through (7–180, default 28)', default: 28 },
      min_position: { type: 'number', description: 'Top of the position band (default 4)', default: 4 },
      max_position: { type: 'number', description: 'Bottom of the position band (default 20)', default: 20 },
      min_impressions: { type: 'number', description: 'Minimum impressions for a page to be considered (default 50)', default: 50 },
      limit: { type: 'number', description: 'Opportunities to return (default 50)', default: 50 },
      gsc_row_limit: { type: 'number', description: 'Search Console page rows to fetch before filtering (default 5000)', default: 5000 },
    },
  },
  annotations: { title: 'Page opportunities (Search Console × GA4)', readOnlyHint: true, openWorldHint: true },
}

export const pageOpportunitiesSpec = native({
  tool: pageOpportunitiesTool,
  schema: pageOpportunitiesInputSchema,
  run: async (input, executor) => {
    const output = await runPageOpportunities(input, executor)
    return { output, isError: !output.success }
  },
})
