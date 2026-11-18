import { z } from 'zod'
import type { CLIExecutor } from '../cli/executor.js'
import type { DataApiResponse, DataApiRow } from '../utils/ga4-data-client.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import { ToolError, ErrorCode, errorResult, toolErrorToFailure, type ToolFailureResult } from '../utils/errors.js'
import { normalizeGa4Property } from '../utils/url-normalize.js'

/**
 * Shared plumbing for the GA4 organic report tools (OpenSEO
 * get_google_analytics_*): property resolution, date windows, the organic
 * channel filter, metric parsing and the error wrapper.
 */

export const ORGANIC_CHANNEL = 'Organic Search'

/** GA4 dimensionFilter that keeps sessions whose default channel group is Organic Search. */
export const ORGANIC_FILTER = {
  filter: {
    fieldName: 'sessionDefaultChannelGroup',
    stringFilter: { matchType: 'EXACT', value: ORGANIC_CHANNEL },
  },
} as const

/** AND several filter expressions (dropping undefined ones). Returns undefined when none remain. */
export function andFilters(...filters: (Record<string, unknown> | undefined)[]): Record<string, unknown> | undefined {
  const present = filters.filter((f): f is Record<string, unknown> => f !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]
  return { andGroup: { expressions: present } }
}

export function eventFilter(eventName: string): Record<string, unknown> {
  return { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: eventName } } }
}

// ============================================================================
// Input
// ============================================================================

export const propertyShape = {
  property_id: z
    .string()
    .min(1)
    .optional()
    .describe('GA4 Property ID: numeric or "properties/N". Not a Measurement ID (G-XXXXXX).'),
  config: z.string().min(1).optional().describe('Path to a YAML config; its ga4.property_id is used. Alternative to property_id.'),
  days: z.number().int().min(1).max(365).optional().default(28).describe('Window in days ending yesterday (default 28).'),
}

export const propertyJsonProps = {
  property_id: {
    type: 'string',
    description: 'GA4 Property ID, e.g. "123456789" or "properties/123456789". Not a G-XXXXXX Measurement ID.',
  },
  config: { type: 'string', description: 'Path to a YAML config file; its ga4.property_id is used. Alternative to property_id.' },
  days: { type: 'number', minimum: 1, maximum: 365, default: 28, description: 'Window in days ending yesterday (default 28).' },
}

export const organicJsonProp = {
  organic: { type: 'boolean', default: true, description: 'Only Organic Search sessions (default true).' },
}

export async function resolvePropertyId(
  input: { property_id?: string; config?: string },
  executor: CLIExecutor,
): Promise<string> {
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

// ============================================================================
// Windows
// ============================================================================

export interface DateWindow {
  start: string
  end: string
}

const DAY_MS = 86_400_000

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The `days`-long window ending yesterday (UTC calendar), and the equal window
 * immediately before it. Absolute dates, so `window` in every result says
 * exactly which days were read.
 */
export function windows(days: number, now: Date = new Date()): { current: DateWindow; previous: DateWindow } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const end = today - DAY_MS
  const start = end - (days - 1) * DAY_MS
  return {
    current: { start: isoDay(start), end: isoDay(end) },
    previous: { start: isoDay(start - days * DAY_MS), end: isoDay(start - DAY_MS) },
  }
}

export function dateRange(w: DateWindow): { startDate: string; endDate: string } {
  return { startDate: w.start, endDate: w.end }
}

// ============================================================================
// Rows
// ============================================================================

export const round = (n: number, dp: number): number => Number(n.toFixed(dp))

export function num(row: DataApiRow | undefined, i: number): number {
  return Number(row?.metricValues?.[i]?.value ?? 0) || 0
}

export function dim(row: DataApiRow | undefined, i: number): string {
  return row?.dimensionValues?.[i]?.value ?? ''
}

/** Map response rows to objects keyed by the given dimension and metric output names. */
export function mapRows(
  data: DataApiResponse,
  dimNames: readonly string[],
  metricNames: readonly string[],
  decimals: Record<string, number> = {},
): Record<string, string | number>[] {
  return (data.rows ?? []).map((row) => {
    const out: Record<string, string | number> = {}
    dimNames.forEach((d, i) => {
      out[d] = dim(row, i)
    })
    metricNames.forEach((m, i) => {
      const v = num(row, i)
      out[m] = decimals[m] !== undefined ? round(v, decimals[m]) : v
    })
    return out
  })
}

/** Totals row (from metricAggregations TOTAL) mapped to named metrics. */
export function mapTotals(
  data: DataApiResponse,
  metricNames: readonly string[],
  decimals: Record<string, number> = {},
): Record<string, number> {
  const row = data.totals?.[0]
  const out: Record<string, number> = {}
  metricNames.forEach((m, i) => {
    const v = num(row, i)
    out[m] = decimals[m] !== undefined ? round(v, decimals[m]) : v
  })
  return out
}

/** Relative change: (cur - prev) / prev, rounded to 4 dp; null when prev is 0. */
export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return round((cur - prev) / prev, 4)
}

// ============================================================================
// Error wrapper
// ============================================================================

export async function guard<T extends { success: true }>(fn: () => Promise<T>): Promise<T | ToolFailureResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

export const ORGANIC_EMPTY_HINT =
  'GA4 recorded no Organic Search sessions in this window. Check that the GA4 tag fires on landing pages, ' +
  'that search referrers are not stripped (strict Referrer-Policy, redirects through a tracker) and that the default channel group ' +
  'has not been overridden. Run ga4_measurement_health for a full check.'
