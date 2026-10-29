import { ToolError, errorCodeForStatus } from './errors.js'

// Chrome UX Report API client (field Core Web Vitals).
// Docs: https://developer.chrome.com/docs/crux/api and /docs/crux/history-api

const CRUX_BASE = 'https://chromeuxreport.googleapis.com/v1/records'
const CRUX_TIMEOUT_MS = 15_000

export type CruxFormFactor = 'PHONE' | 'DESKTOP' | 'TABLET'
export type CruxMetricKey = 'lcp' | 'inp' | 'cls'
export type CwvCategory = 'good' | 'needs-improvement' | 'poor'

const CRUX_METRIC_NAMES: Record<CruxMetricKey, string> = {
  lcp: 'largest_contentful_paint',
  inp: 'interaction_to_next_paint',
  cls: 'cumulative_layout_shift',
}

const METRIC_KEYS = Object.keys(CRUX_METRIC_NAMES) as CruxMetricKey[]

// [good upper bound, needs-improvement upper bound]; lcp/inp in ms, cls unitless.
const THRESHOLDS: Record<CruxMetricKey, [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
}

export function categorize(metric: CruxMetricKey, p75: number): CwvCategory {
  const [good, needsImprovement] = THRESHOLDS[metric]
  if (p75 <= good) return 'good'
  if (p75 <= needsImprovement) return 'needs-improvement'
  return 'poor'
}

export interface CruxMetricResult {
  p75: number
  category: CwvCategory
}

export interface CruxFieldData {
  /** Whether the record is for the exact URL or fell back to the whole origin. */
  scope: 'url' | 'origin'
  form_factor: CruxFormFactor
  collection_period: { first: string; last: string } | null
  metrics: Partial<Record<CruxMetricKey, CruxMetricResult>>
}

export interface CruxHistory {
  scope: 'url' | 'origin'
  form_factor: CruxFormFactor
  /** Last day of each weekly collection period, earliest first. */
  periods: string[]
  /** p75 per period, aligned with `periods`; null where CrUX has no data. */
  series: Partial<Record<CruxMetricKey, Array<number | null>>>
}

interface CruxDateRaw {
  year?: number
  month?: number
  day?: number
}

interface CruxPeriodRaw {
  firstDate?: CruxDateRaw
  lastDate?: CruxDateRaw
  endDate?: CruxDateRaw
}

interface CruxRecordResponse {
  record?: {
    metrics?: Record<string, { percentiles?: { p75?: number | string } }>
    collectionPeriod?: CruxPeriodRaw
  }
}

interface CruxHistoryResponse {
  record?: {
    metrics?: Record<string, { percentilesTimeseries?: { p75s?: Array<number | string | null> } }>
    collectionPeriods?: CruxPeriodRaw[]
  }
}

function fmtDate(d?: CruxDateRaw): string | null {
  if (!d?.year || !d.month || !d.day) return null
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

// CLS p75 arrives as a string ("0.05") and missing history points as null or "NaN".
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** POST to a CrUX endpoint. Returns null on 404 (no data for this URL/origin). */
async function post<T>(endpoint: string, apiKey: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`${CRUX_BASE}:${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CRUX_TIMEOUT_MS),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ToolError(errorCodeForStatus(res.status), `CrUX API error (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

/** Try the exact URL first, then its origin. Returns the scope that had data. */
async function withOriginFallback<T>(
  url: string,
  call: (target: { url: string } | { origin: string }) => Promise<T | null>,
): Promise<{ scope: 'url' | 'origin'; data: T } | null> {
  const byUrl = await call({ url })
  if (byUrl) return { scope: 'url', data: byUrl }
  const byOrigin = await call({ origin: new URL(url).origin })
  return byOrigin ? { scope: 'origin', data: byOrigin } : null
}

/** p75 and category for LCP/INP/CLS. Returns null when neither URL nor origin has a record. */
export async function fetchCruxFieldData(
  url: string,
  formFactor: CruxFormFactor,
  apiKey: string,
): Promise<CruxFieldData | null> {
  const found = await withOriginFallback<CruxRecordResponse>(url, (target) =>
    post('queryRecord', apiKey, {
      ...target,
      formFactor,
      metrics: METRIC_KEYS.map((k) => CRUX_METRIC_NAMES[k]),
    }),
  )
  if (!found) return null

  const record = found.data.record
  const metrics: CruxFieldData['metrics'] = {}
  for (const key of METRIC_KEYS) {
    const p75 = toNumber(record?.metrics?.[CRUX_METRIC_NAMES[key]]?.percentiles?.p75)
    if (p75 !== null) metrics[key] = { p75, category: categorize(key, p75) }
  }

  const cp = record?.collectionPeriod
  const first = fmtDate(cp?.firstDate)
  const last = fmtDate(cp?.lastDate ?? cp?.endDate)

  return {
    scope: found.scope,
    form_factor: formFactor,
    collection_period: first && last ? { first, last } : null,
    metrics,
  }
}

/** Weekly p75 series (earliest first) over the last `weeks` collection periods (1-40). */
export async function fetchCruxHistory(
  url: string,
  formFactor: CruxFormFactor,
  apiKey: string,
  weeks: number,
): Promise<CruxHistory | null> {
  const found = await withOriginFallback<CruxHistoryResponse>(url, (target) =>
    post('queryHistoryRecord', apiKey, {
      ...target,
      formFactor,
      collectionPeriodCount: weeks,
      metrics: METRIC_KEYS.map((k) => CRUX_METRIC_NAMES[k]),
    }),
  )
  if (!found) return null

  const record = found.data.record
  const series: CruxHistory['series'] = {}
  for (const key of METRIC_KEYS) {
    const p75s = record?.metrics?.[CRUX_METRIC_NAMES[key]]?.percentilesTimeseries?.p75s
    if (p75s) series[key] = p75s.map(toNumber)
  }

  return {
    scope: found.scope,
    form_factor: formFactor,
    periods: (record?.collectionPeriods ?? []).map((p) => fmtDate(p.lastDate ?? p.endDate) ?? ''),
    series,
  }
}
