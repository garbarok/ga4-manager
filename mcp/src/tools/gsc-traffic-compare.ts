import { z } from 'zod'
import { native } from '../tool-spec.js'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import {
  ToolError,
  ErrorCode,
  errorResult,
  toolErrorToFailure,
  type ToolFailureResult,
} from '../utils/errors.js'
import { normalizeGscSite, normalizeUrl } from '../utils/url-normalize.js'
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

/** True when `date` is YYYY-MM-DD and a real calendar day (rejects 2026-02-31, 2026-13-01). */
function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

const aroundSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine(isRealDate, 'Date must be a real calendar date')
    .describe('Change date (YYYY-MM-DD), e.g. the GA4 annotation date of a deploy or content update'),
  window_days: z
    .number()
    .int()
    .min(7)
    .max(90)
    .optional()
    .default(28)
    .describe('Days in each window (7-90, default 28)'),
  gap_days: z
    .number()
    .int()
    .min(0)
    .max(14)
    .optional()
    .default(0)
    .describe('Days skipped after the change date before the "after" window starts (0-14, default 0)'),
})

export const gscTrafficCompareInputSchema = z.object({
  site: z
    .string()
    .min(1, 'site is required')
    .describe(
      'GSC site identifier: sc-domain:example.com (domain property) or https://example.com/ (URL prefix)',
    ),
  period_a: dateRangeSchema.optional(),
  period_b: dateRangeSchema.optional(),
  around: aroundSchema
    .optional()
    .describe(
      'Before/after mode, instead of period_a/period_b: period_a = window_days ending the day before date, period_b = window_days starting date + gap_days',
    ),
  pages: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      'Only compare these page URLs (exact match after the chosen normalize mode); requires "page" as the first dimension',
    ),
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

export interface BeforeAfterTotals {
  clicks: number
  impressions: number
  /** null when the window has no impressions: CTR is undefined, not 0 */
  ctr: number | null
  /** null when the window has no impressions: the page was not ranking */
  position: number | null
}

export interface BeforeAfter {
  pages_filter: number | null
  before: BeforeAfterTotals
  after: BeforeAfterTotals
  clicks_delta: number
  impressions_delta: number
  /** null when either window has no impressions */
  ctr_delta: number | null
  /** null when either window has no impressions */
  position_delta: number | null
  /** Target pages (as passed) with no rows left in each period after filtering */
  pages_missing: { period_a: string[]; period_b: string[] }
}

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
      before_after?: BeforeAfter
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

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10)
}

interface ResolvedPeriods {
  period_a: { start: string; end: string }
  period_b: { start: string; end: string }
}

/**
 * Turn `around` into two equal-length periods. If the "after" window would end
 * within 3 days of today (GSC lag), both windows are shortened equally.
 */
function resolveAround(
  around: NonNullable<GscTrafficCompareInput['around']>,
  warnings: string[],
): ResolvedPeriods | ToolFailureResult {
  const { date, gap_days } = around
  if (!isRealDate(date)) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      `around.date (${date}) is not a real calendar date`,
      'Use a valid date in YYYY-MM-DD format',
    )
  }
  let window = around.window_days
  const startB = addDays(date, gap_days)
  const cutoff = addDays(new Date().toISOString().slice(0, 10), -3)

  if (addDays(startB, window - 1) > cutoff) {
    const fitting = periodDays(startB, cutoff)
    if (fitting < 1) {
      return errorResult(
        ErrorCode.INVALID_INPUT,
        `around.date (${date}) with gap_days ${gap_days} leaves no complete GSC data after the change (data ends ${cutoff})`,
        'Wait a few days after the change, or use an earlier date',
      )
    }
    warnings.push(
      `"after" window would end within 3 days of today; both windows shortened from ${window} to ${fitting} days`,
    )
    window = fitting
  }

  return {
    period_a: { start: addDays(date, -window), end: addDays(date, -1) },
    period_b: { start: startB, end: addDays(startB, window - 1) },
  }
}

function totalsOf(rows: GscRow[]): BeforeAfterTotals {
  let clicks = 0
  let impressions = 0
  let positionWeighted = 0
  for (const row of rows) {
    clicks += row.clicks
    impressions += row.impressions
    positionWeighted += row.position * row.impressions
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? positionWeighted / impressions : null,
  }
}

export async function runGscTrafficCompare(
  input: GscTrafficCompareInput,
): Promise<GscTrafficCompareResult> {
  const { site: rawSite, around, pages, dimensions, fetch_limit, output_limit, min_clicks_a, sort_by, normalize } =
    input

  const warnings: string[] = []

  // ── Period selection: explicit periods xor around ────────────────────────

  const hasPeriods = input.period_a !== undefined || input.period_b !== undefined
  if (hasPeriods && around !== undefined) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'Provide either period_a/period_b or around, not both',
      'Drop around to compare explicit periods, or drop period_a/period_b to use before/after mode',
    )
  }
  if (!hasPeriods && around === undefined) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'Provide period_a and period_b, or around',
      'Pass both periods, or around: { date: "YYYY-MM-DD" } for before/after mode',
    )
  }
  if ((input.period_a === undefined) !== (input.period_b === undefined)) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'period_a and period_b must be provided together',
      'Pass both periods, or use around',
    )
  }

  let periods: ResolvedPeriods
  if (around !== undefined) {
    const resolved = resolveAround(around, warnings)
    if ('success' in resolved) return resolved
    periods = resolved
  } else {
    periods = { period_a: input.period_a!, period_b: input.period_b! }
  }
  const { period_a, period_b } = periods

  if (pages !== undefined && dimensions[0] !== 'page') {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'pages filter requires "page" as the first dimension',
      'Set dimensions to ["page"] or ["page", ...]',
    )
  }

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

  let rowsA = (resultA as PromiseFulfilledResult<GscRow[]>).value
  let rowsB = (resultB as PromiseFulfilledResult<GscRow[]>).value

  let pages_missing: BeforeAfter['pages_missing'] = { period_a: [], period_b: [] }
  if (pages !== undefined) {
    const wanted = new Set(pages.map((p) => normalizeUrl(p, normalize)))
    const keyOf = (row: GscRow): string => normalizeUrl(row.keys[0] ?? '', normalize)
    const keep = (row: GscRow): boolean => wanted.has(keyOf(row))
    const fetchedA = rowsA.length
    const fetchedB = rowsB.length
    rowsA = rowsA.filter(keep)
    rowsB = rowsB.filter(keep)

    const missingIn = (rows: GscRow[]): string[] => {
      const found = new Set(rows.map(keyOf))
      const seen = new Set<string>()
      return pages.filter((p) => {
        const key = normalizeUrl(p, normalize)
        if (found.has(key) || seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    pages_missing = { period_a: missingIn(rowsA), period_b: missingIn(rowsB) }

    // Missing pages only signal truncation when the period hit fetch_limit
    for (const [label, fetched, missing] of [
      ['period_a', fetchedA, pages_missing.period_a],
      ['period_b', fetchedB, pages_missing.period_b],
    ] as const) {
      if (fetched >= fetch_limit && missing.length > 0) {
        warnings.push(
          `${label} returned ${fetch_limit} rows (fetch_limit) and these target pages were not among them, so they count as 0 and the deltas may be wrong; raise fetch_limit: ${missing.join(', ')}`,
        )
      }
    }
  }

  const { drops, drops_tail, gains, gains_tail, unchanged, summary, normalize_mode_used } =
    computeTrafficDiff(rowsA, rowsB, {
      min_clicks_a,
      sort_by,
      normalize,
      output_limit,
    })

  let before_after: BeforeAfter | undefined
  if (around !== undefined || pages !== undefined) {
    const before = totalsOf(rowsA)
    const after = totalsOf(rowsB)
    before_after = {
      pages_filter: pages?.length ?? null,
      before,
      after,
      clicks_delta: after.clicks - before.clicks,
      impressions_delta: after.impressions - before.impressions,
      ctr_delta: before.ctr === null || after.ctr === null ? null : after.ctr - before.ctr,
      position_delta:
        before.position === null || after.position === null ? null : after.position - before.position,
      pages_missing,
    }
  }

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
    ...(before_after !== undefined ? { before_after } : {}),
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
    'Before/after mode: pass around { date, window_days (7-90, default 28), gap_days (0-14, default 0) } instead of period_a/period_b ' +
    'to compare the window before a change date with the window after it (a SEOTesting-style test); ' +
    'pair it with GA4 annotation dates of deploys or content updates. ' +
    'If the after window would end within 3 days of today both windows are shortened equally with a warning. ' +
    'Optional pages filter (exact URL match after normalize) targets the changed pages; ' +
    'with around or pages the output adds a before_after block with total clicks/impressions/CTR/position and their deltas. ' +
    'Provide either period_a+period_b or around, never both. ' +
    'Controls: fetch_limit (rows fetched from GSC, default 5000, max 25000), ' +
    'output_limit (rows returned per drops/gains array, default 50, max 500), ' +
    'sort_by (clicks_abs|clicks_pct|impressions_abs, default clicks_abs), ' +
    'min_clicks_a (filter low-traffic URLs before sort, default 0). ' +
    'Tail summaries (drops_tail, gains_tail) report count + total_clicks_delta + 5-row sample for rows beyond output_limit. ' +
    'Makes 2 GSC requests per call (one per period). ' +
    'GSC quota is 2000 requests/day.',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      site: {
        type: 'string',
        description:
          'GSC site identifier: sc-domain:example.com (domain property) or https://example.com/ (URL prefix)',
      },
      period_a: {
        type: 'object',
        required: ['start', 'end'],
        description: 'Baseline (older) period. Required unless around is given',
        properties: {
          start: { type: 'string', description: 'Start date YYYY-MM-DD, e.g. "2026-03-01"' },
          end: { type: 'string', description: 'End date YYYY-MM-DD, e.g. "2026-03-31"' },
        },
      },
      period_b: {
        type: 'object',
        required: ['start', 'end'],
        description: 'Current (newer) period to compare against baseline. Required unless around is given',
        properties: {
          start: { type: 'string', description: 'Start date YYYY-MM-DD, e.g. "2026-04-01"' },
          end: { type: 'string', description: 'End date YYYY-MM-DD, e.g. "2026-04-24"' },
        },
      },
      around: {
        type: 'object',
        required: ['date'],
        description:
          'Before/after mode, mutually exclusive with period_a/period_b: period_a = window_days ending the day before date, period_b = window_days starting date + gap_days',
        properties: {
          date: { type: 'string', description: 'Change date YYYY-MM-DD, e.g. a GA4 annotation date' },
          window_days: { type: 'number', description: 'Days per window (default 28)', default: 28, minimum: 7, maximum: 90 },
          gap_days: { type: 'number', description: 'Days skipped after date before the after window (default 0)', default: 0, minimum: 0, maximum: 14 },
        },
      },
      pages: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Only compare these page URLs (exact match after the normalize mode); requires "page" as the first dimension. Adds totals over this set to before_after',
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
  annotations: { title: 'Compare Search Console traffic', readOnlyHint: true },
}

export const gscTrafficCompareSpec = native({
  tool: gscTrafficCompareTool,
  schema: gscTrafficCompareInputSchema,
  run: async (input) => {
    const output = await runGscTrafficCompare(input)
    return { output, isError: !output.success }
  },
})
