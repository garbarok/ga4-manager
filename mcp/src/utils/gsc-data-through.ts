import { querySearchAnalytics } from '../tools/gsc-traffic-compare.js'

/**
 * Last date (YYYY-MM-DD) Search Console has data for, from a date-dimension
 * query over the last 14 days (one quota unit). Mirrors gsc.DataThrough in Go
 * so native GSC tools report the same `data_through` as the CLI-backed ones.
 * Returns null on any failure: it is context, never a reason to fail a tool.
 */
export async function gscDataThrough(site: string, now: Date = new Date()): Promise<string | null> {
  const end = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10)
  try {
    const rows = await querySearchAnalytics(site, start, end, ['date'], 30)
    return latestDate(rows.map((r) => r.keys?.[0]))
  } catch {
    return null
  }
}

export function latestDate(keys: (string | undefined)[]): string | null {
  let max: string | null = null
  for (const k of keys) if (k && /^\d{4}-\d{2}-\d{2}$/.test(k) && (max === null || k > max)) max = k
  return max
}
