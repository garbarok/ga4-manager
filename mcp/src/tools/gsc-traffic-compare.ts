import { z } from 'zod'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'

// ============================================================================
// Input Schema
// ============================================================================

const dateRangeSchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
})

export const gscTrafficCompareInputSchema = z.object({
  /** Site URL: sc-domain:example.com or https://example.com/ */
  site: z.string().min(1, 'site is required'),
  /** Baseline (older) period */
  period_a: dateRangeSchema,
  /** Current (newer) period */
  period_b: dateRangeSchema,
  /** Dimensions to query (default: ["page"]) */
  dimensions: z.array(z.string()).optional().default(['page']),
  /** Max rows per period from GSC API (default: 500, max 25000) */
  limit: z.number().int().min(1).max(25000).optional().default(500),
  /** Only include URLs with >= N clicks in period_a (reduces noise) */
  min_clicks_a: z.number().int().min(0).optional().default(0),
  /** Sort metric for drops/gains lists */
  sort_by: z
    .enum(['clicks_abs', 'clicks_pct', 'impressions_abs'])
    .optional()
    .default('clicks_abs'),
})

export type GscTrafficCompareInput = z.infer<typeof gscTrafficCompareInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface TrafficDiff {
  url: string
  clicks_a: number
  clicks_b: number
  clicks_delta: number
  clicks_pct: number
  impressions_a: number
  impressions_b: number
  impressions_delta: number
  ctr_a: number
  ctr_b: number
  position_a: number
  position_b: number
}

export interface TrafficCompareSummary {
  urls_compared: number
  urls_only_in_a: number
  urls_only_in_b: number
}

export interface GscTrafficCompareOutput {
  success: boolean
  site: string
  period_a: string
  period_b: string
  summary: TrafficCompareSummary
  drops: TrafficDiff[]
  gains: TrafficDiff[]
  unchanged: number
  error?: string
}

// ============================================================================
// GSC API Types
// ============================================================================

interface GscSearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GscSearchAnalyticsResponse {
  rows?: GscSearchAnalyticsRow[]
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Query GSC Search Analytics API for a single date range
 */
export async function querySearchAnalytics(
  site: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  limit: number,
): Promise<GscSearchAnalyticsRow[]> {
  const authHeaders = await getGoogleAuthHeaders([
    'https://www.googleapis.com/auth/webmasters.readonly',
  ])

  const encodedSite = encodeURIComponent(site)
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`

  const body = {
    startDate,
    endDate,
    dimensions,
    rowLimit: limit,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 403) {
      throw new Error(
        'GSC access denied — check service account has Search Console access',
      )
    }
    if (response.status === 429) {
      throw new Error('GSC quota exceeded — 2000 req/day limit')
    }
    throw new Error(`GSC API error (HTTP ${response.status}): ${text}`)
  }

  const data = (await response.json()) as GscSearchAnalyticsResponse
  return data.rows ?? []
}

/**
 * Build a map from URL key to row data
 */
function buildUrlMap(rows: GscSearchAnalyticsRow[]): Map<string, GscSearchAnalyticsRow> {
  const map = new Map<string, GscSearchAnalyticsRow>()
  for (const row of rows) {
    // The first key dimension is the URL (page dimension)
    const key = row.keys.join('|')
    map.set(key, row)
  }
  return map
}

/**
 * Sort comparator for TrafficDiff based on sort_by field
 */
function getSortValue(diff: TrafficDiff, sortBy: GscTrafficCompareInput['sort_by']): number {
  switch (sortBy) {
    case 'clicks_pct':
      return Math.abs(diff.clicks_pct)
    case 'impressions_abs':
      return Math.abs(diff.impressions_delta)
    case 'clicks_abs':
    default:
      return Math.abs(diff.clicks_delta)
  }
}

/**
 * Core comparison logic: join two period result sets and compute deltas
 */
export function compareTrafficPeriods(
  rowsA: GscSearchAnalyticsRow[],
  rowsB: GscSearchAnalyticsRow[],
  minClicksA: number,
  sortBy: GscTrafficCompareInput['sort_by'],
): {
  drops: TrafficDiff[]
  gains: TrafficDiff[]
  unchanged: number
  summary: TrafficCompareSummary
} {
  const mapA = buildUrlMap(rowsA)
  const mapB = buildUrlMap(rowsB)

  const allKeysA = new Set(mapA.keys())
  const allKeysB = new Set(mapB.keys())

  const commonKeys: string[] = []
  for (const key of allKeysA) {
    if (allKeysB.has(key)) {
      commonKeys.push(key)
    }
  }

  const urls_only_in_a = [...allKeysA].filter((k) => !allKeysB.has(k)).length
  const urls_only_in_b = [...allKeysB].filter((k) => !allKeysA.has(k)).length

  const drops: TrafficDiff[] = []
  const gains: TrafficDiff[] = []
  let unchanged = 0

  for (const key of commonKeys) {
    const a = mapA.get(key)!
    const b = mapB.get(key)!

    // Apply min_clicks_a filter
    if (a.clicks < minClicksA) {
      continue
    }

    const clicks_delta = b.clicks - a.clicks
    const clicks_pct =
      a.clicks > 0 ? ((b.clicks - a.clicks) / a.clicks) * 100 : 0
    const impressions_delta = b.impressions - a.impressions

    const diff: TrafficDiff = {
      url: key,
      clicks_a: a.clicks,
      clicks_b: b.clicks,
      clicks_delta,
      clicks_pct: Math.round(clicks_pct * 10) / 10,
      impressions_a: a.impressions,
      impressions_b: b.impressions,
      impressions_delta,
      ctr_a: a.ctr,
      ctr_b: b.ctr,
      position_a: a.position,
      position_b: b.position,
    }

    // Classify: < -5% = drop, > +5% = gain, otherwise unchanged
    if (clicks_pct < -5) {
      drops.push(diff)
    } else if (clicks_pct > 5) {
      gains.push(diff)
    } else {
      unchanged++
    }
  }

  // Sort drops worst-first, gains best-first
  drops.sort((a, b) => getSortValue(b, sortBy) - getSortValue(a, sortBy))
  gains.sort((a, b) => getSortValue(b, sortBy) - getSortValue(a, sortBy))

  return {
    drops: drops.slice(0, 50),
    gains: gains.slice(0, 50),
    unchanged,
    summary: {
      urls_compared: commonKeys.length,
      urls_only_in_a,
      urls_only_in_b,
    },
  }
}

/**
 * Run the full gsc_traffic_compare tool
 */
export async function runGscTrafficCompare(
  input: GscTrafficCompareInput,
): Promise<GscTrafficCompareOutput> {
  const { site, period_a, period_b, dimensions, limit, min_clicks_a, sort_by } =
    input

  const periodAStr = `${period_a.start} to ${period_a.end}`
  const periodBStr = `${period_b.start} to ${period_b.end}`

  try {
    const [rowsA, rowsB] = await Promise.all([
      querySearchAnalytics(site, period_a.start, period_a.end, dimensions, limit),
      querySearchAnalytics(site, period_b.start, period_b.end, dimensions, limit),
    ])

    const { drops, gains, unchanged, summary } = compareTrafficPeriods(
      rowsA,
      rowsB,
      min_clicks_a,
      sort_by,
    )

    return {
      success: true,
      site,
      period_a: periodAStr,
      period_b: periodBStr,
      summary,
      drops,
      gains,
      unchanged,
    }
  } catch (err) {
    return {
      success: false,
      site,
      period_a: periodAStr,
      period_b: periodBStr,
      summary: { urls_compared: 0, urls_only_in_a: 0, urls_only_in_b: 0 },
      drops: [],
      gains: [],
      unchanged: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscTrafficCompareTool = {
  name: 'gsc_traffic_compare',
  description:
    'Compare GSC Search Analytics traffic between two date ranges. ' +
    'Identifies URLs with the biggest drops and gains in clicks/impressions. ' +
    'Useful for diagnosing traffic changes after algorithm updates, site changes, or seasonal shifts.',
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
          start: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
          },
          end: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format',
          },
        },
      },
      period_b: {
        type: 'object',
        required: ['start', 'end'],
        description: 'Current (newer) period to compare against baseline',
        properties: {
          start: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
          },
          end: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format',
          },
        },
      },
      dimensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dimensions to break down by (default: ["page"])',
        default: ['page'],
      },
      limit: {
        type: 'number',
        description: 'Max rows per period from GSC API (default: 500, max 25000)',
        default: 500,
        minimum: 1,
        maximum: 25000,
      },
      min_clicks_a: {
        type: 'number',
        description:
          'Minimum clicks in period_a to include URL in comparison (filters noise, default: 0)',
        default: 0,
        minimum: 0,
      },
      sort_by: {
        type: 'string',
        enum: ['clicks_abs', 'clicks_pct', 'impressions_abs'],
        description:
          'Sort metric for drops/gains lists (default: clicks_abs — absolute click change)',
        default: 'clicks_abs',
      },
    },
  },
}
