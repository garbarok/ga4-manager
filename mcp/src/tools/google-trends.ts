import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

const TIME_RANGES = [
  'past_hour',
  'past_4_hours',
  'past_day',
  'past_7_days',
  'past_30_days',
  'past_90_days',
  'past_12_months',
  'past_5_years',
] as const

export const googleTrendsInputSchema = z
  .object({
    keywords: z.array(z.string().min(1).max(100)).min(1).max(5).describe('1–5 keywords to compare (Google Trends limit)'),
    location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
    language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
    type: z.enum(['web', 'news', 'youtube', 'images', 'froogle']).optional().default('web').describe('Google property (default: "web"; "froogle" = Shopping)'),
    time_range: z.enum(TIME_RANGES).optional().default('past_12_months').describe('Preset period (default: "past_12_months"); ignored when date_from is set'),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Custom start date yyyy-mm-dd (overrides time_range)'),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Custom end date yyyy-mm-dd (default: today)'),
    include_series: z.boolean().optional().default(true).describe('Return the full time series, not just the per-keyword summary (default: true)'),
  })
  .refine((v) => !v.date_to || v.date_from, { message: 'date_to requires date_from', path: ['date_to'] })

export type GoogleTrendsInput = z.infer<typeof googleTrendsInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface TrendSummary {
  keyword: string
  /** Mean interest over the period, 0–100 relative to the busiest point across all keywords. */
  average: number | null
  latest: number | null
  peak: number | null
  peak_date: string | null
  /** % change of the last quarter of the period vs the first quarter; null when the first quarter is all zero. */
  change_pct: number | null
}

export interface TrendPoint {
  date_from: string
  date_to: string
  /** Interest per keyword, in the same order as `keywords`; null where Google reports missing data. */
  values: (number | null)[]
}

export type GoogleTrendsResult =
  | { success: true; keywords: string[]; summary: TrendSummary[]; series?: TrendPoint[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface TrendsGraphPoint {
  date_from?: string
  date_to?: string
  missing_data?: boolean
  values?: (number | null)[] | null
}

interface TrendsItem {
  type?: string
  keywords?: string[] | null
  data?: TrendsGraphPoint[] | null
  averages?: (number | null)[] | null
}

interface TrendsExploreResult {
  items?: TrendsItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)

/** Per-keyword summary of a Trends interest-over-time series. */
export function summarizeTrend(keyword: string, index: number, series: TrendPoint[], reportedAverage: number | null | undefined): TrendSummary {
  const points = series
    .map((p) => ({ date: p.date_from, v: p.values[index] }))
    .filter((p): p is { date: string; v: number } => typeof p.v === 'number')

  if (points.length === 0) {
    return { keyword, average: null, latest: null, peak: null, peak_date: null, change_pct: null }
  }

  const peak = points.reduce((best, p) => (p.v > best.v ? p : best))
  const quarter = Math.max(1, Math.floor(points.length / 4))
  const first = mean(points.slice(0, quarter).map((p) => p.v)) ?? 0
  const last = mean(points.slice(-quarter).map((p) => p.v)) ?? 0

  return {
    keyword,
    average: typeof reportedAverage === 'number' ? reportedAverage : round1(mean(points.map((p) => p.v))),
    latest: points[points.length - 1].v,
    peak: peak.v,
    peak_date: peak.date,
    change_pct: first > 0 ? Math.round(((last - first) / first) * 100) : null,
  }
}

export async function runGoogleTrends(input: GoogleTrendsInput): Promise<GoogleTrendsResult> {
  try {
    const { items, cost } = await dataforseoRequest<TrendsExploreResult>({
      path: 'keywords_data/google_trends/explore/live',
      task: {
        keywords: input.keywords,
        location_name: input.location_name,
        language_code: input.language_code,
        type: input.type,
        ...(input.date_from
          ? { date_from: input.date_from, ...(input.date_to ? { date_to: input.date_to } : {}) }
          : { time_range: input.time_range }),
      },
    })

    const graph = (items[0]?.items ?? []).find((it) => it.type === 'google_trends_graph')
    if (!graph?.data?.length) {
      return errorResult(ErrorCode.NOT_FOUND, 'Google Trends returned no interest data for these keywords (search volume may be too low).')
    }

    const keywords = graph.keywords?.length ? graph.keywords : input.keywords
    const series: TrendPoint[] = graph.data.map((p) => ({
      date_from: p.date_from ?? '',
      date_to: p.date_to ?? '',
      values: keywords.map((_, i) => (p.missing_data ? null : (p.values?.[i] ?? null))),
    }))
    const summary = keywords.map((kw, i) => summarizeTrend(kw, i, series, graph.averages?.[i]))

    return {
      success: true,
      keywords,
      summary,
      ...(input.include_series ? { series } : {}),
      cost_usd: cost,
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const googleTrendsTool = {
  name: 'google_trends',
  description:
    'Use when the user wants to know whether interest in a topic is rising or falling, its seasonality, or how up to 5 terms compare over time ' +
    '(e.g. when to publish or refresh a page, which phrasing is gaining). ' +
    'Backed by DataForSEO Keywords Data → Google Trends explore — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Billed per call (~$0.011, regardless of keyword count). ' +
    'Values are relative interest 0–100 (100 = busiest point across all compared keywords), not search volume — pair with keyword_volume for absolute demand. ' +
    'Returns per-keyword summary (average, latest, peak, peak_date, change_pct last vs first quarter of the period), the time series (include_series), and cost_usd.',
  inputSchema: {
    type: 'object',
    required: ['keywords'],
    properties: {
      keywords: { type: 'array', items: { type: 'string' }, description: '1–5 keywords to compare' },
      location_name: { type: 'string', description: 'DataForSEO location name (default: "United States")', default: 'United States' },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      type: {
        type: 'string',
        enum: ['web', 'news', 'youtube', 'images', 'froogle'],
        description: 'Google property (default: "web"; "froogle" = Shopping)',
        default: 'web',
      },
      time_range: {
        type: 'string',
        enum: [...TIME_RANGES],
        description: 'Preset period (default: "past_12_months"); ignored when date_from is set',
        default: 'past_12_months',
      },
      date_from: { type: 'string', description: 'Custom start date yyyy-mm-dd (overrides time_range)' },
      date_to: { type: 'string', description: 'Custom end date yyyy-mm-dd (requires date_from)' },
      include_series: { type: 'boolean', description: 'Return the full time series (default: true)', default: true },
    },
  },
  annotations: { title: 'Google Trends interest over time', readOnlyHint: true, openWorldHint: true },
}

export const googleTrendsSpec = native({
  tool: googleTrendsTool,
  schema: googleTrendsInputSchema,
  run: async (input) => {
    const output = await runGoogleTrends(input)
    return { output, isError: !output.success }
  },
})
