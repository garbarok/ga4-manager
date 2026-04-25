// Pure module for computing per-URL traffic deltas between two GSC periods.
// Extracted from gsc-traffic-compare for isolated unit testing.

import { normalizeUrl, type NormalizeMode } from '../utils/url-normalize.js'

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

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
  ctr_delta: number
  position_a: number
  position_b: number
  position_delta: number
}

export interface TrafficDiffSummary {
  urls_compared: number
  urls_only_in_a: number
  urls_only_in_b: number
}

export interface TrafficDiffOptions {
  min_clicks_a?: number
  sort_by?: 'clicks_abs' | 'clicks_pct' | 'impressions_abs'
  output_limit?: number
  normalize?: NormalizeMode
}

export interface TrafficDiffResult {
  drops: TrafficDiff[]
  gains: TrafficDiff[]
  unchanged: number
  summary: TrafficDiffSummary
  normalize_mode_used: NormalizeMode
}

function buildUrlMap(rows: GscRow[], normalize: NormalizeMode): Map<string, GscRow> {
  const map = new Map<string, GscRow>()
  for (const row of rows) {
    // Normalize the first key (page URL) only; other dimensions (country, etc.) are kept verbatim
    const normalizedFirstKey = normalizeUrl(row.keys[0] ?? '', normalize)
    const compositeKey = [normalizedFirstKey, ...row.keys.slice(1)].join('|')
    // Last writer wins when normalization collapses multiple forms to the same key
    const existing = map.get(compositeKey)
    if (existing === undefined) {
      map.set(compositeKey, row)
    } else {
      // Merge by summing clicks/impressions, averaging position and ctr
      map.set(compositeKey, {
        keys: [normalizedFirstKey, ...row.keys.slice(1)],
        clicks: existing.clicks + row.clicks,
        impressions: existing.impressions + row.impressions,
        ctr: (existing.ctr + row.ctr) / 2,
        position: (existing.position + row.position) / 2,
      })
    }
  }
  return map
}

function getSortValue(
  diff: TrafficDiff,
  sortBy: TrafficDiffOptions['sort_by'],
): number {
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
 * Inner-join two GSC result sets by URL key and compute per-URL deltas.
 *
 * @param rowsA - Baseline (period A) rows
 * @param rowsB - Current (period B) rows
 * @param opts  - Filtering and sorting options
 */
export function computeTrafficDiff(
  rowsA: GscRow[],
  rowsB: GscRow[],
  opts: TrafficDiffOptions = {},
): TrafficDiffResult {
  const { min_clicks_a = 0, sort_by = 'clicks_abs', output_limit = 50, normalize = 'minimal' } = opts

  const mapA = buildUrlMap(rowsA, normalize)
  const mapB = buildUrlMap(rowsB, normalize)

  const keysA = new Set(mapA.keys())
  const keysB = new Set(mapB.keys())

  const commonKeys = [...keysA].filter((k) => keysB.has(k))
  const urls_only_in_a = [...keysA].filter((k) => !keysB.has(k)).length
  const urls_only_in_b = [...keysB].filter((k) => !keysA.has(k)).length

  const drops: TrafficDiff[] = []
  const gains: TrafficDiff[] = []
  let unchanged = 0

  for (const key of commonKeys) {
    const a = mapA.get(key)!
    const b = mapB.get(key)!

    if (a.clicks < min_clicks_a) continue

    const clicks_delta = b.clicks - a.clicks
    const clicks_pct =
      a.clicks > 0 ? ((b.clicks - a.clicks) / a.clicks) * 100 : 0
    const impressions_delta = b.impressions - a.impressions
    const ctr_delta = b.ctr - a.ctr
    const position_delta = b.position - a.position

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
      ctr_delta: Math.round(ctr_delta * 10000) / 10000,
      position_a: a.position,
      position_b: b.position,
      position_delta: Math.round(position_delta * 10) / 10,
    }

    if (clicks_pct < -5) {
      drops.push(diff)
    } else if (clicks_pct > 5) {
      gains.push(diff)
    } else {
      unchanged++
    }
  }

  // Drops: worst losses first; gains: best gains first
  drops.sort((a, b) => getSortValue(b, sort_by) - getSortValue(a, sort_by))
  gains.sort((a, b) => getSortValue(b, sort_by) - getSortValue(a, sort_by))

  return {
    drops: drops.slice(0, output_limit),
    gains: gains.slice(0, output_limit),
    unchanged,
    summary: {
      urls_compared: commonKeys.length,
      urls_only_in_a,
      urls_only_in_b,
    },
    normalize_mode_used: normalize,
  }
}
