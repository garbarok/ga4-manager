import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { runReport, type DataApiResponse } from '../utils/ga4-data-client.js'
import { ToolError, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import {
  ORGANIC_FILTER,
  ORGANIC_EMPTY_HINT,
  andFilters,
  eventFilter,
  propertyShape,
  propertyJsonProps,
  organicJsonProp,
  resolvePropertyId,
  windows,
  dateRange,
  mapRows,
  mapTotals,
  pctDelta,
  round,
  num,
  guard,
  type DateWindow,
} from './ga4-organic-shared.js'

/**
 * GA4 organic reports (OpenSEO get_google_analytics_*): overview with
 * previous-period comparison and trend, landing pages, key events,
 * acquisition, audience, site search and ecommerce. All read-only GA4 Data
 * API reports; "organic" means sessionDefaultChannelGroup = Organic Search.
 */

type Row = Record<string, string | number>

interface BaseSuccess {
  success: true
  warnings: string[]
  property_id: string
  window: DateWindow
}

/** GA4 metric api name → output field name, with display decimals. */
interface MetricDef {
  api: string
  out: string
  dp?: number
}

const SESSION_METRICS: MetricDef[] = [
  { api: 'sessions', out: 'sessions' },
  { api: 'engagedSessions', out: 'engaged_sessions' },
  { api: 'engagementRate', out: 'engagement_rate', dp: 4 },
  { api: 'keyEvents', out: 'key_events' },
  { api: 'sessionKeyEventRate', out: 'session_key_event_rate', dp: 4 },
  { api: 'totalRevenue', out: 'revenue', dp: 2 },
]

function apiMetrics(defs: MetricDef[]) {
  return defs.map((d) => ({ name: d.api }))
}
function outNames(defs: MetricDef[]) {
  return defs.map((d) => d.out)
}
function decimalsOf(defs: MetricDef[]): Record<string, number> {
  return Object.fromEntries(defs.filter((d) => d.dp !== undefined).map((d) => [d.out, d.dp!]))
}

/** Add share_of_<metric> (0–1, 4 dp) to each row against a total. */
function withShare(rows: Row[], metric: string, total: number): Row[] {
  return rows.map((r) => ({ ...r, [`share_of_${metric}`]: total > 0 ? round(Number(r[metric]) / total, 4) : 0 }))
}

const organicField = z.boolean().optional().default(true).describe('Only Organic Search sessions (default true).')
const limitField = z.number().int().min(1).max(1000).optional().default(50)

// ============================================================================
// ga4_organic_overview
// ============================================================================

const OVERVIEW_METRICS: MetricDef[] = [
  ...SESSION_METRICS,
  { api: 'totalUsers', out: 'users' },
  { api: 'newUsers', out: 'new_users' },
  { api: 'averageSessionDuration', out: 'avg_session_duration_s', dp: 1 },
]

export const ga4OrganicOverviewInputSchema = z.object({
  ...propertyShape,
  granularity: z.enum(['day', 'week']).optional().default('day').describe('Trend granularity (default "day").'),
})
export type Ga4OrganicOverviewInput = z.infer<typeof ga4OrganicOverviewInputSchema>

export interface MetricComparison {
  current: number
  previous: number
  change: number
  /** Relative change (0.1 = +10%); null when the previous value is 0. */
  change_pct: number | null
}

export type Ga4OrganicOverviewResult =
  | (BaseSuccess & {
      previous_window: DateWindow
      metrics: Record<string, MetricComparison>
      /** Organic sessions / all sessions in the current window (null when there are no sessions). */
      organic_share_of_sessions: number | null
      granularity: 'day' | 'week'
      trend: Row[]
    })
  | ToolFailureResult

function firstRowMetrics(data: DataApiResponse, defs: MetricDef[]): Record<string, number> {
  const row = data.rows?.[0]
  const dec = decimalsOf(defs)
  const out: Record<string, number> = {}
  defs.forEach((d, i) => {
    const v = num(row, i)
    out[d.out] = dec[d.out] !== undefined ? round(v, dec[d.out]) : v
  })
  return out
}

export function compareMetrics(cur: Record<string, number>, prev: Record<string, number>): Record<string, MetricComparison> {
  const out: Record<string, MetricComparison> = {}
  for (const key of Object.keys(cur)) {
    const c = cur[key] ?? 0
    const p = prev[key] ?? 0
    out[key] = { current: c, previous: p, change: round(c - p, 4), change_pct: pctDelta(c, p) }
  }
  return out
}

/** "202611" (isoYearIsoWeek) → "2026-W11"; dates "20261101" → "2026-11-01". */
export function formatPeriod(value: string, granularity: 'day' | 'week'): string {
  if (granularity === 'day' && /^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  if (granularity === 'week' && /^\d{6}$/.test(value)) return `${value.slice(0, 4)}-W${value.slice(4, 6)}`
  return value
}

export async function runGa4OrganicOverview(input: Ga4OrganicOverviewInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4OrganicOverviewResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current, previous } = windows(input.days, now)
    const trendDim = input.granularity === 'week' ? 'isoYearIsoWeek' : 'date'

    const [cur, prev, all, trend] = await Promise.all([
      runReport(propertyId, { dateRanges: [dateRange(current)], metrics: apiMetrics(OVERVIEW_METRICS), dimensionFilter: ORGANIC_FILTER }),
      runReport(propertyId, { dateRanges: [dateRange(previous)], metrics: apiMetrics(OVERVIEW_METRICS), dimensionFilter: ORGANIC_FILTER }),
      runReport(propertyId, { dateRanges: [dateRange(current)], metrics: [{ name: 'sessions' }] }),
      runReport(propertyId, {
        dateRanges: [dateRange(current)],
        dimensions: [{ name: trendDim }],
        metrics: apiMetrics(SESSION_METRICS),
        dimensionFilter: ORGANIC_FILTER,
        orderBys: [{ dimension: { dimensionName: trendDim }, desc: false }],
        limit: 400,
      }),
    ])

    const curM = firstRowMetrics(cur, OVERVIEW_METRICS)
    const prevM = firstRowMetrics(prev, OVERVIEW_METRICS)
    const allSessions = num(all.rows?.[0], 0)
    const warnings: string[] = []
    if (curM.sessions === 0) warnings.push(ORGANIC_EMPTY_HINT)
    if (curM.sessions > 0 && prevM.sessions === 0) {
      warnings.push('The previous window has no organic sessions, so percentage changes are null (property too new, or tagging changed).')
    }

    return {
      success: true,
      warnings,
      property_id: propertyId,
      window: current,
      previous_window: previous,
      metrics: compareMetrics(curM, prevM),
      organic_share_of_sessions: allSessions > 0 ? round(curM.sessions / allSessions, 4) : null,
      granularity: input.granularity,
      trend: mapRows(trend, ['period'], outNames(SESSION_METRICS), decimalsOf(SESSION_METRICS)).map((r) => ({
        ...r,
        period: formatPeriod(String(r.period), input.granularity),
      })),
    }
  })
}

export const ga4OrganicOverviewTool = {
  name: 'ga4_organic_overview',
  description:
    'Use when the user asks how organic (Google search) traffic is doing in GA4: sessions, engaged sessions, engagement rate, key events, ' +
    'session key event rate, revenue, users and new users for Organic Search sessions, each compared with the equal window immediately before ' +
    '(change and change_pct), plus organic share of all sessions and a daily or weekly trend. Pass property_id or a config path. ' +
    'Default: last 28 days ending yesterday. Read-only; 4 GA4 Data API requests.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      granularity: { type: 'string', enum: ['day', 'week'], default: 'day', description: 'Trend granularity (default "day").' },
    },
  },
  annotations: { title: 'GA4 organic overview', readOnlyHint: true, openWorldHint: true },
}

export const ga4OrganicOverviewSpec = native({
  tool: ga4OrganicOverviewTool,
  schema: ga4OrganicOverviewInputSchema,
  run: async (input, executor) => {
    const output = await runGa4OrganicOverview(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_organic_landing_pages
// ============================================================================

const LANDING_METRICS: MetricDef[] = [...SESSION_METRICS, { api: 'averageSessionDuration', out: 'avg_session_duration_s', dp: 1 }]

const LANDING_ORDER = {
  sessions: 'sessions',
  key_events: 'keyEvents',
  revenue: 'totalRevenue',
  engagement_rate: 'engagementRate',
  key_event_rate: 'sessionKeyEventRate',
} as const
type LandingOrder = keyof typeof LANDING_ORDER

export const ga4OrganicLandingPagesInputSchema = z.object({
  ...propertyShape,
  organic: organicField,
  include_query_string: z.boolean().optional().default(false).describe('Use landingPagePlusQueryString instead of landingPage (default false).'),
  order_by: z.enum(Object.keys(LANDING_ORDER) as [LandingOrder, ...LandingOrder[]]).optional().default('sessions'),
  limit: limitField,
})
export type Ga4OrganicLandingPagesInput = z.infer<typeof ga4OrganicLandingPagesInputSchema>

export type Ga4OrganicLandingPagesResult =
  | (BaseSuccess & { organic: boolean; dimension: string; order_by: string; rows: Row[]; totals: Record<string, number>; total_rows: number })
  | ToolFailureResult

export async function runGa4OrganicLandingPages(input: Ga4OrganicLandingPagesInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4OrganicLandingPagesResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const dimension = input.include_query_string ? 'landingPagePlusQueryString' : 'landingPage'
    const data = await runReport(propertyId, {
      dateRanges: [dateRange(current)],
      dimensions: [{ name: dimension }],
      metrics: apiMetrics(LANDING_METRICS),
      ...(input.organic ? { dimensionFilter: ORGANIC_FILTER } : {}),
      orderBys: [{ metric: { metricName: LANDING_ORDER[input.order_by] }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: input.limit,
    })
    const rows = mapRows(data, ['landing_page'], outNames(LANDING_METRICS), decimalsOf(LANDING_METRICS))
    const totals = mapTotals(data, outNames(LANDING_METRICS), decimalsOf(LANDING_METRICS))
    const warnings: string[] = []
    if (rows.length === 0) warnings.push(input.organic ? ORGANIC_EMPTY_HINT : 'GA4 recorded no sessions in this window.')
    const notSet = rows.find((r) => r.landing_page === '(not set)')
    if (notSet && totals.sessions > 0 && Number(notSet.sessions) / totals.sessions > 0.1) {
      warnings.push(
        'More than 10% of sessions have landing page "(not set)": sessions started without a page_view (e.g. a session timed out and resumed, or events fire before the config tag).',
      )
    }
    return {
      success: true,
      warnings,
      property_id: propertyId,
      window: current,
      organic: input.organic,
      dimension,
      order_by: input.order_by,
      rows,
      totals,
      total_rows: data.rowCount ?? 0,
    }
  })
}

export const ga4OrganicLandingPagesTool = {
  name: 'ga4_organic_landing_pages',
  description:
    'Use when the user asks which pages organic visitors land on and what those visits are worth: per landing page, sessions, engaged sessions, ' +
    'engagement rate, key events, session key event rate, revenue and average session duration, plus totals. Organic Search only by default ' +
    '(organic: false for all channels). Order by sessions, key_events, revenue, engagement_rate or key_event_rate. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      ...organicJsonProp,
      include_query_string: { type: 'boolean', default: false, description: 'Keep query strings in landing pages (default false).' },
      order_by: { type: 'string', enum: Object.keys(LANDING_ORDER), default: 'sessions', description: 'Sort metric, descending (default "sessions").' },
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 organic landing pages', readOnlyHint: true, openWorldHint: true },
}

export const ga4OrganicLandingPagesSpec = native({
  tool: ga4OrganicLandingPagesTool,
  schema: ga4OrganicLandingPagesInputSchema,
  run: async (input, executor) => {
    const output = await runGa4OrganicLandingPages(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_key_events
// ============================================================================

export const ga4KeyEventsInputSchema = z.object({
  ...propertyShape,
  organic: organicField,
  by_landing_page: z.boolean().optional().default(false).describe('Break key events down by landing page too (default false).'),
  limit: limitField,
})
export type Ga4KeyEventsInput = z.infer<typeof ga4KeyEventsInputSchema>

export type Ga4KeyEventsResult =
  | (BaseSuccess & { organic: boolean; rows: Row[]; total_key_events: number })
  | ToolFailureResult

const KEY_EVENTS_POSITIVE = {
  filter: { fieldName: 'keyEvents', numericFilter: { operation: 'GREATER_THAN', value: { int64Value: '0' } } },
}

export async function runGa4KeyEvents(input: Ga4KeyEventsInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4KeyEventsResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const dims = input.by_landing_page ? ['eventName', 'landingPage'] : ['eventName']
    const data = await runReport(propertyId, {
      dateRanges: [dateRange(current)],
      dimensions: dims.map((name) => ({ name })),
      metrics: [{ name: 'keyEvents' }, { name: 'totalUsers' }],
      ...(input.organic ? { dimensionFilter: ORGANIC_FILTER } : {}),
      metricFilter: KEY_EVENTS_POSITIVE,
      orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: input.limit,
    })
    const rows = mapRows(data, input.by_landing_page ? ['event_name', 'landing_page'] : ['event_name'], ['key_events', 'users'])
    const total = num(data.totals?.[0], 0)
    const warnings: string[] = []
    if (rows.length === 0) {
      warnings.push(
        (input.organic ? 'No key events in Organic Search sessions in this window. ' : 'No key events in this window. ') +
          'Either no event is marked as a key event (GA4 Admin → Data display → Events → "Mark as key event"), or none happened. ' +
          'Run ga4_measurement_health to tell which.',
      )
    }
    return { success: true, warnings, property_id: propertyId, window: current, organic: input.organic, rows, total_key_events: total }
  })
}

export const ga4KeyEventsTool = {
  name: 'ga4_key_events',
  description:
    'Use when the user asks which conversions/key events organic visitors complete: key event counts by event name (and optionally by landing page), ' +
    'Organic Search only by default. Explains an empty result (no key events configured vs none happened). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      ...organicJsonProp,
      by_landing_page: { type: 'boolean', default: false, description: 'Also break down by landing page (default false).' },
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 key events', readOnlyHint: true, openWorldHint: true },
}

export const ga4KeyEventsSpec = native({
  tool: ga4KeyEventsTool,
  schema: ga4KeyEventsInputSchema,
  run: async (input, executor) => {
    const output = await runGa4KeyEvents(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_traffic_acquisition
// ============================================================================

const ACQ_BREAKDOWN = {
  channel: ['sessionDefaultChannelGroup'],
  source_medium: ['sessionSourceMedium'],
  channel_source_medium: ['sessionDefaultChannelGroup', 'sessionSourceMedium'],
} as const
type AcqBreakdown = keyof typeof ACQ_BREAKDOWN
const ACQ_OUT: Record<string, string> = { sessionDefaultChannelGroup: 'channel', sessionSourceMedium: 'source_medium' }

const ACQ_METRICS: MetricDef[] = [...SESSION_METRICS, { api: 'totalUsers', out: 'users' }, { api: 'newUsers', out: 'new_users' }]

export const ga4TrafficAcquisitionInputSchema = z.object({
  ...propertyShape,
  breakdown: z.enum(Object.keys(ACQ_BREAKDOWN) as [AcqBreakdown, ...AcqBreakdown[]]).optional().default('channel'),
  limit: limitField,
})
export type Ga4TrafficAcquisitionInput = z.infer<typeof ga4TrafficAcquisitionInputSchema>

export type Ga4TrafficAcquisitionResult =
  | (BaseSuccess & { breakdown: string; rows: Row[]; totals: Record<string, number> })
  | ToolFailureResult

export async function runGa4TrafficAcquisition(input: Ga4TrafficAcquisitionInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4TrafficAcquisitionResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const dims = ACQ_BREAKDOWN[input.breakdown]
    const data = await runReport(propertyId, {
      dateRanges: [dateRange(current)],
      dimensions: dims.map((name) => ({ name })),
      metrics: apiMetrics(ACQ_METRICS),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: input.limit,
    })
    const totals = mapTotals(data, outNames(ACQ_METRICS), decimalsOf(ACQ_METRICS))
    const rows = withShare(mapRows(data, dims.map((d) => ACQ_OUT[d]), outNames(ACQ_METRICS), decimalsOf(ACQ_METRICS)), 'sessions', totals.sessions)
    const warnings: string[] = []
    if (rows.length === 0) warnings.push('GA4 recorded no sessions in this window: check the tag is installed and the property ID is right.')
    else if (input.breakdown !== 'source_medium' && !rows.some((r) => r.channel === 'Organic Search')) warnings.push(ORGANIC_EMPTY_HINT)
    return { success: true, warnings, property_id: propertyId, window: current, breakdown: input.breakdown, rows, totals }
  })
}

export const ga4TrafficAcquisitionTool = {
  name: 'ga4_traffic_acquisition',
  description:
    'Use when the user asks where traffic comes from: sessions, engaged sessions, engagement rate, key events, key event rate, revenue, users and new users ' +
    'by default channel group, by source/medium, or both, with each row\'s share of sessions. All channels (this is the comparison view). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      breakdown: {
        type: 'string',
        enum: Object.keys(ACQ_BREAKDOWN),
        default: 'channel',
        description: 'channel, source_medium or channel_source_medium (default "channel").',
      },
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 traffic acquisition', readOnlyHint: true, openWorldHint: true },
}

export const ga4TrafficAcquisitionSpec = native({
  tool: ga4TrafficAcquisitionTool,
  schema: ga4TrafficAcquisitionInputSchema,
  run: async (input, executor) => {
    const output = await runGa4TrafficAcquisition(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_audience
// ============================================================================

const AUDIENCE_DIM = { country: 'country', device: 'deviceCategory', new_vs_returning: 'newVsReturning' } as const
type AudienceBreakdown = keyof typeof AUDIENCE_DIM

const AUDIENCE_METRICS: MetricDef[] = [
  { api: 'totalUsers', out: 'users' },
  { api: 'newUsers', out: 'new_users' },
  { api: 'sessions', out: 'sessions' },
  { api: 'engagementRate', out: 'engagement_rate', dp: 4 },
  { api: 'keyEvents', out: 'key_events' },
  { api: 'sessionKeyEventRate', out: 'session_key_event_rate', dp: 4 },
]

export const ga4AudienceInputSchema = z.object({
  ...propertyShape,
  breakdown: z.enum(Object.keys(AUDIENCE_DIM) as [AudienceBreakdown, ...AudienceBreakdown[]]).optional().default('country'),
  organic: organicField,
  limit: limitField,
})
export type Ga4AudienceInput = z.infer<typeof ga4AudienceInputSchema>

export type Ga4AudienceResult =
  | (BaseSuccess & { breakdown: string; organic: boolean; rows: Row[]; totals: Record<string, number> })
  | ToolFailureResult

export async function runGa4Audience(input: Ga4AudienceInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4AudienceResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const dimension = AUDIENCE_DIM[input.breakdown]
    const data = await runReport(propertyId, {
      dateRanges: [dateRange(current)],
      dimensions: [{ name: dimension }],
      metrics: apiMetrics(AUDIENCE_METRICS),
      ...(input.organic ? { dimensionFilter: ORGANIC_FILTER } : {}),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: input.limit,
    })
    const totals = mapTotals(data, outNames(AUDIENCE_METRICS), decimalsOf(AUDIENCE_METRICS))
    const rows = withShare(mapRows(data, [input.breakdown], outNames(AUDIENCE_METRICS), decimalsOf(AUDIENCE_METRICS)), 'sessions', totals.sessions)
    const warnings: string[] = []
    if (rows.length === 0) warnings.push(input.organic ? ORGANIC_EMPTY_HINT : 'GA4 recorded no sessions in this window.')
    if (input.breakdown === 'new_vs_returning' && rows.some((r) => r.new_vs_returning === '(not set)')) {
      warnings.push('Some sessions are "(not set)" for new vs returning: usually users who denied analytics cookies under Consent Mode.')
    }
    return { success: true, warnings, property_id: propertyId, window: current, breakdown: input.breakdown, organic: input.organic, rows, totals }
  })
}

export const ga4AudienceTool = {
  name: 'ga4_audience',
  description:
    'Use when the user asks who the (organic) visitors are: users, new users, sessions, engagement rate, key events and key event rate ' +
    'by country, device category, or new vs returning, with each row\'s share of sessions. Organic Search only by default. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      breakdown: {
        type: 'string',
        enum: Object.keys(AUDIENCE_DIM),
        default: 'country',
        description: 'country, device or new_vs_returning (default "country").',
      },
      ...organicJsonProp,
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 audience breakdown', readOnlyHint: true, openWorldHint: true },
}

export const ga4AudienceSpec = native({
  tool: ga4AudienceTool,
  schema: ga4AudienceInputSchema,
  run: async (input, executor) => {
    const output = await runGa4Audience(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_site_search
// ============================================================================

export const SITE_SEARCH_EVENT = 'view_search_results'

export const ga4SiteSearchInputSchema = z.object({
  ...propertyShape,
  organic: z.boolean().optional().default(false).describe('Only searches made in Organic Search sessions (default false).'),
  limit: limitField,
})
export type Ga4SiteSearchInput = z.infer<typeof ga4SiteSearchInputSchema>

export type Ga4SiteSearchResult =
  | (BaseSuccess & { organic: boolean; rows: Row[]; total_searches: number })
  | ToolFailureResult

export const SITE_SEARCH_EMPTY_HINT =
  `No ${SITE_SEARCH_EVENT} events with a search term in this window. Site search tracking is probably off: enable it in ` +
  'GA4 Admin → Data streams → (web stream) → Enhanced measurement → Site search, and list your search query parameter ' +
  '(q, s, search, query or keyword by default). Sites without an internal search have nothing to report here.'

export async function runGa4SiteSearch(input: Ga4SiteSearchInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4SiteSearchResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const data = await runReport(propertyId, {
      dateRanges: [dateRange(current)],
      dimensions: [{ name: 'searchTerm' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: andFilters(eventFilter(SITE_SEARCH_EVENT), input.organic ? ORGANIC_FILTER : undefined),
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit: input.limit,
    })
    const rows = mapRows(data, ['search_term'], ['searches', 'users']).filter((r) => r.search_term !== '(not set)' && r.search_term !== '')
    const warnings = rows.length === 0 ? [SITE_SEARCH_EMPTY_HINT] : []
    return {
      success: true,
      warnings,
      property_id: propertyId,
      window: current,
      organic: input.organic,
      rows,
      total_searches: num(data.totals?.[0], 0),
    }
  })
}

export const ga4SiteSearchTool = {
  name: 'ga4_site_search',
  description:
    'Use when the user asks what visitors search for on the site (content gaps, intent): search terms from GA4 view_search_results events ' +
    'with search counts and users. Explains an empty result (site search not enabled in enhanced measurement). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      organic: { type: 'boolean', default: false, description: 'Only searches in Organic Search sessions (default false).' },
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 site search terms', readOnlyHint: true, openWorldHint: true },
}

export const ga4SiteSearchSpec = native({
  tool: ga4SiteSearchTool,
  schema: ga4SiteSearchInputSchema,
  run: async (input, executor) => {
    const output = await runGa4SiteSearch(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ga4_ecommerce
// ============================================================================

const ECOM_TOTAL_METRICS: MetricDef[] = [
  { api: 'ecommercePurchases', out: 'purchases' },
  { api: 'purchaseRevenue', out: 'purchase_revenue', dp: 2 },
  { api: 'averagePurchaseRevenue', out: 'average_purchase_revenue', dp: 2 },
  { api: 'totalRevenue', out: 'total_revenue', dp: 2 },
]

const ITEM_METRICS: MetricDef[] = [
  { api: 'itemsViewed', out: 'items_viewed' },
  { api: 'itemsAddedToCart', out: 'items_added_to_cart' },
  { api: 'itemsPurchased', out: 'items_purchased' },
  { api: 'itemRevenue', out: 'item_revenue', dp: 2 },
]

export const ga4EcommerceInputSchema = z.object({
  ...propertyShape,
  organic: organicField,
  limit: limitField,
})
export type Ga4EcommerceInput = z.infer<typeof ga4EcommerceInputSchema>

export type Ga4EcommerceResult =
  | (BaseSuccess & {
      organic: boolean
      totals: Record<string, number>
      items: Row[]
      /** False when GA4 refused to filter item metrics by channel and items cover all channels. */
      items_filtered_to_organic: boolean
    })
  | ToolFailureResult

export const ECOMMERCE_EMPTY_HINT =
  'No purchases or item activity in this window. If the site sells online, ecommerce events are not reaching GA4: send purchase ' +
  '(with transaction_id, value, currency and items[]) and view_item / add_to_cart per the GA4 ecommerce schema. Content sites can ignore this.'

export async function runGa4Ecommerce(input: Ga4EcommerceInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4EcommerceResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const filter = input.organic ? { dimensionFilter: ORGANIC_FILTER } : {}
    const warnings: string[] = []

    const totalsData = await runReport(propertyId, { dateRanges: [dateRange(current)], metrics: apiMetrics(ECOM_TOTAL_METRICS), ...filter })
    const itemsBody = {
      dateRanges: [dateRange(current)],
      dimensions: [{ name: 'itemName' }],
      metrics: apiMetrics(ITEM_METRICS),
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
      limit: input.limit,
    }
    let itemsData: DataApiResponse
    let itemsFiltered = input.organic
    try {
      itemsData = await runReport(propertyId, { ...itemsBody, ...filter })
    } catch (err) {
      // Item-scoped metrics can be incompatible with a session-scoped channel filter.
      if (!(input.organic && err instanceof ToolError && err.code === ErrorCode.INVALID_INPUT)) throw err
      itemsData = await runReport(propertyId, itemsBody)
      itemsFiltered = false
      warnings.push('GA4 could not filter item metrics to Organic Search, so items cover all channels.')
    }

    const totals = firstRowMetrics(totalsData, ECOM_TOTAL_METRICS)
    const items = mapRows(itemsData, ['item_name'], outNames(ITEM_METRICS), decimalsOf(ITEM_METRICS))
    if (totals.purchases === 0 && items.length === 0) warnings.push(ECOMMERCE_EMPTY_HINT)
    else if (totals.purchases > 0 && items.length === 0) {
      warnings.push('Purchases were recorded but no items: the purchase event is sent without an items[] array.')
    }
    return { success: true, warnings, property_id: propertyId, window: current, organic: input.organic, totals, items, items_filtered_to_organic: itemsFiltered }
  })
}

export const ga4EcommerceTool = {
  name: 'ga4_ecommerce',
  description:
    'Use when the user asks what organic traffic sells: purchases, purchase revenue, average purchase revenue and total revenue, plus per item ' +
    'views, add-to-carts, purchases and item revenue. Organic Search only by default. Explains an empty result (no ecommerce tracking). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      ...organicJsonProp,
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max item rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 ecommerce', readOnlyHint: true, openWorldHint: true },
}

export const ga4EcommerceSpec = native({
  tool: ga4EcommerceTool,
  schema: ga4EcommerceInputSchema,
  run: async (input, executor) => {
    const output = await runGa4Ecommerce(input, executor)
    return { output, isError: !output.success }
  },
})

