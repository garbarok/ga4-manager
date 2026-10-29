import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { runReport, type DataApiRow } from '../utils/ga4-data-client.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import {
  ToolError,
  ErrorCode,
  errorResult,
  toolErrorToFailure,
  type ToolFailureResult,
} from '../utils/errors.js'
import { normalizeGa4Property } from '../utils/url-normalize.js'

// ============================================================================
// Input Schema
// ============================================================================

export const TRAFFIC_DIMENSIONS = [
  'pagePath',
  'landingPage',
  'sessionDefaultChannelGroup',
  'sessionSource',
  'country',
  'deviceCategory',
  'date',
] as const

/** order_by input → GA4 metric api name. */
const ORDER_METRIC = {
  sessions: 'sessions',
  page_views: 'screenPageViews',
  ad_revenue: 'totalAdRevenue',
  engagement_rate: 'engagementRate',
} as const

/**
 * Requested metrics, in response order. The publisher* / totalAdRevenue
 * metrics are populated only when AdSense is linked to the property; they are
 * always requested so the columns are present (as 0) either way.
 */
const METRICS = [
  'sessions',
  'engagedSessions',
  'engagementRate',
  'averageSessionDuration',
  'screenPageViews',
  'totalAdRevenue',
  'publisherAdImpressions',
  'publisherAdClicks',
] as const

export const ga4TrafficReportInputSchema = z.object({
  property_id: z
    .string()
    .min(1)
    .optional()
    .describe('GA4 Property ID: numeric or "properties/N". Not a Measurement ID (G-XXXXXX).'),
  config: z
    .string()
    .min(1)
    .optional()
    .describe('Path to a YAML config; its ga4.property_id is used. Alternative to property_id.'),
  days: z.number().int().min(1).max(365).optional().default(28),
  dimensions: z
    .array(z.enum(TRAFFIC_DIMENSIONS))
    .min(1)
    .max(2)
    .optional()
    .default(['pagePath']),
  order_by: z
    .enum(Object.keys(ORDER_METRIC) as [keyof typeof ORDER_METRIC, ...(keyof typeof ORDER_METRIC)[]])
    .optional()
    .default('sessions'),
  limit: z.number().int().min(1).max(1000).optional().default(50),
})

export type Ga4TrafficReportInput = z.infer<typeof ga4TrafficReportInputSchema>

// ============================================================================
// Result Types
// ============================================================================

export interface TrafficMetrics {
  sessions: number
  engaged_sessions: number
  engagement_rate: number
  average_session_duration_s: number
  page_views: number
  ad_revenue: number
  ad_impressions: number
  ad_clicks: number
  revenue_per_1k_sessions: number
}

export type TrafficRow = Record<string, string> & TrafficMetrics

export type Ga4TrafficReportResult =
  | {
      success: true
      warnings: string[]
      property_id: string
      period: string
      dimensions: string[]
      order_by: string
      rows: TrafficRow[]
      totals: TrafficMetrics
      total_rows: number
    }
  | ToolFailureResult

export const AD_REVENUE_UNAVAILABLE = 'ad_revenue_unavailable'

// ============================================================================
// Pure mapping
// ============================================================================

const round = (n: number, dp: number) => Number(n.toFixed(dp))

/** Map a positional metricValues array (in METRICS order) to named metrics. */
export function toTrafficMetrics(values: { value: string }[] | undefined): TrafficMetrics {
  const v = (i: number) => Number(values?.[i]?.value ?? 0) || 0
  const sessions = v(0)
  const adRevenue = v(5)
  return {
    sessions,
    engaged_sessions: v(1),
    engagement_rate: round(v(2), 4),
    average_session_duration_s: round(v(3), 1),
    page_views: v(4),
    ad_revenue: round(adRevenue, 4),
    ad_impressions: v(6),
    ad_clicks: v(7),
    revenue_per_1k_sessions: sessions > 0 ? round((adRevenue / sessions) * 1000, 2) : 0,
  }
}

export function toTrafficRow(dimensions: readonly string[], row: DataApiRow): TrafficRow {
  const dims: Record<string, string> = {}
  dimensions.forEach((d, i) => {
    dims[d] = row.dimensionValues?.[i]?.value ?? ''
  })
  return { ...dims, ...toTrafficMetrics(row.metricValues) } as TrafficRow
}

// ============================================================================
// Handler
// ============================================================================

async function resolvePropertyId(input: Ga4TrafficReportInput, executor: CLIExecutor): Promise<string> {
  if (input.property_id) return normalizeGa4Property(input.property_id)
  if (input.config) {
    const [cfg] = await resolveConfigs(executor, { config: input.config })
    if (!cfg?.property_id) {
      throw new ToolError(
        ErrorCode.INVALID_INPUT,
        `Config ${input.config} has no ga4.property_id`,
        'Add ga4.property_id to the config, or pass property_id directly.',
      )
    }
    return normalizeGa4Property(cfg.property_id)
  }
  throw new ToolError(ErrorCode.INVALID_INPUT, 'Provide either property_id or config.')
}

export async function runGa4TrafficReport(
  input: Ga4TrafficReportInput,
  executor: CLIExecutor,
): Promise<Ga4TrafficReportResult> {
  try {
    const propertyId = await resolvePropertyId(input, executor)
    const { days, dimensions, order_by, limit } = input

    const data = await runReport(propertyId, {
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: METRICS.map((name) => ({ name })),
      orderBys: [{ metric: { metricName: ORDER_METRIC[order_by] }, desc: true }],
      metricAggregations: ['TOTAL'],
      limit,
    })

    const totals = toTrafficMetrics(data.totals?.[0]?.metricValues)
    const warnings: string[] = []
    if (totals.ad_impressions === 0) {
      warnings.push(
        `${AD_REVENUE_UNAVAILABLE}: no AdSense ad impressions in the last ${days} days. ` +
          'If the site runs AdSense, link it to GA4 (GA4 Admin → Product links → AdSense) so revenue is attributed per page.',
      )
    }

    return {
      success: true,
      warnings,
      property_id: propertyId,
      period: `last ${days} days`,
      dimensions,
      order_by,
      rows: (data.rows ?? []).map((r) => toTrafficRow(dimensions, r)),
      totals,
      total_rows: data.rowCount ?? 0,
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const ga4TrafficReportTool = {
  name: 'ga4_traffic_report',
  description:
    'Use when the user asks which pages, landing pages, channels, sources, countries or devices bring traffic or ad revenue on their own site. ' +
    'Runs a GA4 Data API report: sessions, engaged sessions, engagement rate, avg session duration, page views, and — when AdSense is linked to GA4 — ad revenue, ad impressions, ad clicks and revenue_per_1k_sessions per row, plus totals. ' +
    'Pass property_id or a config path. Default: last 28 days by pagePath, ordered by sessions. ' +
    'Use order_by="ad_revenue" to find the pages that earn the most. ' +
    'Warning "ad_revenue_unavailable" means no ad impressions were attributed (AdSense not linked, or no ads served). Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: {
        type: 'string',
        description: 'GA4 Property ID, e.g. "123456789" or "properties/123456789". Not a G-XXXXXX Measurement ID.',
      },
      config: {
        type: 'string',
        description: 'Path to a YAML config file; its ga4.property_id is used. Alternative to property_id.',
      },
      days: { type: 'number', minimum: 1, maximum: 365, default: 28, description: 'Window in days ending yesterday (default 28).' },
      dimensions: {
        type: 'array',
        items: { type: 'string', enum: [...TRAFFIC_DIMENSIONS] },
        minItems: 1,
        maxItems: 2,
        default: ['pagePath'],
        description: 'Up to two breakdown dimensions (default ["pagePath"]).',
      },
      order_by: {
        type: 'string',
        enum: Object.keys(ORDER_METRIC),
        default: 'sessions',
        description: 'Metric to sort rows by, descending (default "sessions").',
      },
      limit: { type: 'number', minimum: 1, maximum: 1000, default: 50, description: 'Max rows (default 50).' },
    },
  },
  annotations: { title: 'GA4 traffic & ad revenue report', readOnlyHint: true, openWorldHint: true },
}

export const ga4TrafficReportSpec = native({
  tool: ga4TrafficReportTool,
  schema: ga4TrafficReportInputSchema,
  run: async (input, executor) => {
    const output = await runGa4TrafficReport(input, executor)
    return { output, isError: !output.success }
  },
})
