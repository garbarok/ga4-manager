import { z } from 'zod'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import {
  ToolError,
  ErrorCode,
  errorResult,
  toolErrorToFailure,
  type ToolFailureResult,
} from '../utils/errors.js'
import { normalizeGscSite } from '../utils/url-normalize.js'
import {
  computeTrafficDiff,
  type GscRow,
  type TrafficDiff,
  type TrafficDiffSummary,
  type TrafficTail,
} from './compute-traffic-diff.js'

// Re-export for consumers that need the diff types
export type { TrafficDiff, TrafficDiffSummary, TrafficTail }

// ============================================================================
// Input Schema
// ============================================================================

const dateRangeSchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .describe('Start date (YYYY-MM-DD), e.g. "2026-03-01"'),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .describe('End date (YYYY-MM-DD), e.g. "2026-03-31"'),
})

export const gscTrafficCompareInputSchema = z.object({
  site: z
    .string()
    .min(1, 'site is required')
    .describe(
      'GSC site identifier: sc-domain:example.com (domain property) or https://example.com/ (URL prefix)',
    ),
  period_a: dateRangeSchema,
  period_b: dateRangeSchema,
  dimensions: z
    .array(z.string())
    .optional()
    .default(['page'])
    .describe('Dimensions to query, e.g. ["page"] or ["page","country"]'),
  fetch_limit: z
    .number()
    .int()
    .min(1)
    .max(25000)
    .optional()
    .default(5000)
    .describe('Max rows fetched per period from GSC API (default: 5000, max 25000)'),
  output_limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Max drops/gains rows returned in output arrays (default: 50, max 500)'),
  min_clicks_a: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Minimum clicks in period_a to include URL (filters noise, default: 0)'),
  sort_by: z
    .enum(['clicks_abs', 'clicks_pct', 'impressions_abs'])
    .optional()
    .default('clicks_abs')
    .describe('Sort metric for drops/gains: "clicks_abs" (default), "clicks_pct", "impressions_abs"'),
  normalize: z
    .enum(['none', 'minimal', 'aggressive'])
    .optional()
    .default('minimal')
    .describe(
      'URL normalization before inner-join: "none" (no change), "minimal" (strip trailing slash, lowercase host, default), "aggressive" (minimal + drop www., force https://, drop query string)',
    ),
})

export type GscTrafficCompareInput = z.infer<typeof gscTrafficCompareInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export type GscTrafficCompareResult =
  | {
      success: true
      warnings: string[]
      site: string
      period_a: string
      period_b: string
      summary: TrafficDiffSummary
      drops: TrafficDiff[]
      drops_tail: TrafficTail
      gains: TrafficDiff[]
      gains_tail: TrafficTail
      unchanged: number
      normalize_mode_used: string
    }
  | ToolFailureResult

// ============================================================================
// GSC API
// ============================================================================

/**
 * Query GSC Search Analytics API for a single date range.
 * Throws ToolError with structured code on known HTTP errors.
 */
export async function querySearchAnalytics(
  site: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  limit: number,
): Promise<GscRow[]> {
  const authHeaders = await getGoogleAuthHeaders([
    'https://www.googleapis.com/auth/webmasters.readonly',
  ])

  const encodedSite = encodeURIComponent(site)
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`

  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: limit }),
  })

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 403) {
      throw new ToolError(
        ErrorCode.AUTH_DENIED,
        'GSC access denied (HTTP 403)',
        'Add the service account email as a user in Search Console for this site',
      )
    }
    if (response.status === 429) {
      throw new ToolError(
        ErrorCode.QUOTA_EXCEEDED,
        'GSC quota exceeded (HTTP 429)',
        'GSC limit is 2000 req/day; retry tomorrow',
      )
    }
    throw new ToolError(
      ErrorCode.UPSTREAM_5XX,
      `GSC API error (HTTP ${response.status}): ${text}`,
    )
  }

  const data = (await response.json()) as { rows?: GscRow[] }
  return data.rows ?? []
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Run the gsc_traffic_compare tool.
 * Both GSC period requests run in parallel via Promise.allSettled so a single
 * period failure is diagnosable without blocking the other.
 */
// Returns number of days between two YYYY-MM-DD dates (end - start, inclusive)
function periodDays(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86400000 + 1
}

export async function runGscTrafficCompare(
  input: GscTrafficCompareInput,
): Promise<GscTrafficCompareResult> {
  const { site: rawSite, period_a, period_b, dimensions, fetch_limit, output_limit, min_clicks_a, sort_by, normalize } =
    input

  // ── Input validation ────────────────────────────────────────────────────

  if (fetch_limit <= output_limit) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      `fetch_limit (${fetch_limit}) must be greater than output_limit (${output_limit})`,
      'Increase fetch_limit or decrease output_limit so output_limit < fetch_limit',
    )
  }

  // ── Date-range validation ────────────────────────────────────────────────

  if (period_a.start > period_a.end) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      `period_a start (${period_a.start}) is after end (${period_a.end})`,
      'Ensure start <= end in YYYY-MM-DD format',
    )
  }

  if (period_b.start > period_b.end) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      `period_b start (${period_b.start}) is after end (${period_b.end})`,
      'Ensure start <= end in YYYY-MM-DD format',
    )
  }

  const warnings: string[] = []

  // Warn if periods overlap
  if (period_a.end >= period_b.start) {
    warnings.push(
      `Periods overlap (period_a ends ${period_a.end}, period_b starts ${period_b.start}); results may double-count shared dates`,
    )
  }

  // Warn if period_b.end is within the GSC 48-hour data lag
  const today = new Date().toISOString().slice(0, 10)
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  if (period_b.end > twoDaysAgo) {
    warnings.push(
      `period_b end (${period_b.end}) is within 48 hours of today (${today}); GSC data may be incomplete`,
    )
  }

  // Warn if periods are different lengths
  const daysA = periodDays(period_a.start, period_a.end)
  const daysB = periodDays(period_b.start, period_b.end)
  if (daysA !== daysB) {
    warnings.push(
      `Periods are different lengths (period_a: ${daysA} days, period_b: ${daysB} days); per-period totals are not directly comparable`,
    )
  }

  // ── Site normalization ───────────────────────────────────────────────────

  const { site, warning: siteWarning } = normalizeGscSite(rawSite)
  if (siteWarning !== undefined) {
    warnings.push(siteWarning)
  }

  const [resultA, resultB] = await Promise.allSettled([
    querySearchAnalytics(site, period_a.start, period_a.end, dimensions, fetch_limit),
    querySearchAnalytics(site, period_b.start, period_b.end, dimensions, fetch_limit),
  ])

  const aFailed = resultA.status === 'rejected'
  const bFailed = resultB.status === 'rejected'

  if (aFailed && bFailed) {
    // Both failed — propagate the first specific ToolError code when available
    const reasonA = resultA.reason as unknown
    const reasonB = (resultB as PromiseRejectedResult).reason as unknown
    if (reasonA instanceof ToolError) return toolErrorToFailure(reasonA)
    if (reasonB instanceof ToolError) return toolErrorToFailure(reasonB)
    return errorResult(
      ErrorCode.UPSTREAM_5XX,
      reasonA instanceof Error ? reasonA.message : String(reasonA),
    )
  }

  if (aFailed || bFailed) {
    const failedLabel = aFailed ? 'period_a' : 'period_b'
    const succeededLabel = aFailed ? 'period_b' : 'period_a'
    const rawErr = aFailed
      ? resultA.reason
      : (resultB as PromiseRejectedResult).reason
    const msg = rawErr instanceof Error ? rawErr.message : String(rawErr)
    return errorResult(
      ErrorCode.PARTIAL_FETCH_FAILED,
      `${failedLabel} failed: ${msg}`,
      `${succeededLabel} succeeded; retry ${failedLabel} only`,
    )
  }

  const rowsA = (resultA as PromiseFulfilledResult<GscRow[]>).value
  const rowsB = (resultB as PromiseFulfilledResult<GscRow[]>).value

  const { drops, drops_tail, gains, gains_tail, unchanged, summary, normalize_mode_used } =
    computeTrafficDiff(rowsA, rowsB, {
      min_clicks_a,
      sort_by,
      normalize,
      output_limit,
    })

  return {
    success: true,
    warnings,
    site,
    period_a: `${period_a.start} to ${period_a.end}`,
    period_b: `${period_b.start} to ${period_b.end}`,
    summary,
    drops,
    drops_tail,
    gains,
    gains_tail,
    unchanged,
    normalize_mode_used,
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscTrafficCompareTool = {
  name: 'gsc_traffic_compare',
  description:
    'Use when the user asks why organic traffic dropped or which pages changed. ' +
    'Compares Google Search Console search analytics between two date ranges per URL, ' +
    'returning the top drops and gains. ' +
    'Controls: fetch_limit (rows fetched from GSC, default 5000, max 25000), ' +
    'output_limit (rows returned per drops/gains array, default 50, max 500), ' +
    'sort_by (clicks_abs|clicks_pct|impressions_abs, default clicks_abs), ' +
    'min_clicks_a (filter low-traffic URLs before sort, default 0). ' +
    'Tail summaries (drops_tail, gains_tail) report count + total_clicks_delta + 5-row sample for rows beyond output_limit. ' +
    'Makes 2 GSC requests per call (one per period). ' +
    'GSC quota is 2000 requests/day.',
  inputSchema: {
    type: 'object',
    required: ['site', 'period_a', 'period_b'],
    properties: {
      site: {
        type: 'string',
        description:
          'GSC site identifier: sc-domain:example.com (domain property) or https://example.com/ (URL prefix)',
      },
      period_a: {
        type: 'object',
        required: ['start', 'end'],
        description: 'Baseline (older) period',
        properties: {
          start: { type: 'string', description: 'Start date YYYY-MM-DD, e.g. "2026-03-01"' },
          end: { type: 'string', description: 'End date YYYY-MM-DD, e.g. "2026-03-31"' },
        },
      },
      period_b: {
        type: 'object',
        required: ['start', 'end'],
        description: 'Current (newer) period to compare against baseline',
        properties: {
          start: { type: 'string', description: 'Start date YYYY-MM-DD, e.g. "2026-04-01"' },
          end: { type: 'string', description: 'End date YYYY-MM-DD, e.g. "2026-04-24"' },
        },
      },
      dimensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dimensions to break down by (default: ["page"])',
        default: ['page'],
      },
      fetch_limit: {
        type: 'number',
        description: 'Max rows fetched per period from GSC API (default: 5000, max 25000)',
        default: 5000,
        minimum: 1,
        maximum: 25000,
      },
      output_limit: {
        type: 'number',
        description: 'Max drops/gains rows returned in output arrays (default: 50, max 500)',
        default: 50,
        minimum: 1,
        maximum: 500,
      },
      min_clicks_a: {
        type: 'number',
        description:
          'Minimum clicks in period_a to include URL (filters noise, default: 0)',
        default: 0,
        minimum: 0,
      },
      sort_by: {
        type: 'string',
        enum: ['clicks_abs', 'clicks_pct', 'impressions_abs'],
        description:
          'Sort metric for drops/gains (default: clicks_abs — absolute click change)',
        default: 'clicks_abs',
      },
      normalize: {
        type: 'string',
        enum: ['none', 'minimal', 'aggressive'],
        description:
          'URL normalization mode before inner-join: "none" (no change), "minimal" (strip trailing slash + lowercase host, default), "aggressive" (minimal + drop www. + force https:// + drop query string)',
        default: 'minimal',
      },
    },
  },
}
