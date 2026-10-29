// Pure functions behind site_growth_brief: page join across GSC and GA4,
// KPI deltas, and the findings digest. No I/O — the tool module orchestrates
// the API/CLI calls and feeds the results in here.

// ============================================================================
// Page join
// ============================================================================

/**
 * Reduce a GSC page URL or a GA4 pagePath to a comparable path: fragment and
 * query string dropped, trailing slash stripped (root stays "/"), lowercased.
 * Host is discarded so www/non-www variants and GA4's host-less pagePath meet.
 */
export function normalizePagePath(urlOrPath: string): string {
  let path = urlOrPath.trim()
  const scheme = path.indexOf('://')
  if (scheme >= 0) {
    const slash = path.indexOf('/', scheme + 3)
    path = slash >= 0 ? path.slice(slash) : '/'
  }
  path = path.split('#')[0].split('?')[0].toLowerCase()
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

export interface GscPageMetrics {
  page: string
  clicks: number
  impressions: number
}

export interface Ga4PageMetrics {
  pagePath: string
  sessions: number
  ad_revenue: number
}

export interface TopPage {
  path: string
  gsc_clicks: number | null
  gsc_impressions: number | null
  sessions: number | null
  ad_revenue: number | null
}

/**
 * Join GSC and GA4 pages on normalized path. GSC variants of one path
 * (fragments, query strings, hosts) are summed; GA4 variants likewise. A
 * page seen by only one source keeps nulls for the other. Ranked by ad
 * revenue desc (null last), then GSC clicks desc, then path asc.
 */
export function joinTopPages(gsc: GscPageMetrics[], ga4: Ga4PageMetrics[], limit = 10): TopPage[] {
  const byPath = new Map<string, TopPage>()
  const entry = (path: string): TopPage => {
    let e = byPath.get(path)
    if (!e) {
      e = { path, gsc_clicks: null, gsc_impressions: null, sessions: null, ad_revenue: null }
      byPath.set(path, e)
    }
    return e
  }

  for (const r of gsc) {
    const e = entry(normalizePagePath(r.page))
    e.gsc_clicks = (e.gsc_clicks ?? 0) + r.clicks
    e.gsc_impressions = (e.gsc_impressions ?? 0) + r.impressions
  }
  for (const r of ga4) {
    const e = entry(normalizePagePath(r.pagePath))
    e.sessions = (e.sessions ?? 0) + r.sessions
    e.ad_revenue = sig4((e.ad_revenue ?? 0) + r.ad_revenue)
  }

  return [...byPath.values()]
    .sort(
      (a, b) =>
        (b.ad_revenue ?? -1) - (a.ad_revenue ?? -1) ||
        (b.gsc_clicks ?? -1) - (a.gsc_clicks ?? -1) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, limit)
}

// ============================================================================
// KPIs
// ============================================================================

export interface Kpis {
  gsc_clicks: number | null
  gsc_impressions: number | null
  gsc_ctr: number | null
  gsc_position: number | null
  sessions: number | null
  engagement_rate: number | null
  ad_revenue: number | null
  revenue_per_1k_sessions: number | null
}

export const EMPTY_KPIS: Kpis = {
  gsc_clicks: null,
  gsc_impressions: null,
  gsc_ctr: null,
  gsc_position: null,
  sessions: null,
  engagement_rate: null,
  ad_revenue: null,
  revenue_per_1k_sessions: null,
}

/**
 * Percentage change current vs previous per KPI (e.g. 25 = +25%). Null when
 * either side is null or the previous value is 0 (no meaningful ratio).
 */
export function kpiDeltas(current: Kpis, previous: Kpis): Record<keyof Kpis, number | null> {
  const out = {} as Record<keyof Kpis, number | null>
  for (const key of Object.keys(current) as (keyof Kpis)[]) {
    const c = current[key]
    const p = previous[key]
    out[key] = c === null || p === null || p === 0 ? null : round4(((c - p) / p) * 100)
  }
  return out
}

// ============================================================================
// Findings digest
// ============================================================================

export type FindingSource = 'opportunities' | 'ctr_anomaly' | 'url_hygiene' | 'hreflang'

export interface Finding {
  source: FindingSource
  summary: string
  page: string
  /** Estimated clicks per window at stake; null when the diagnostic has no click estimate. */
  impact: number | null
}

export const MAX_FINDINGS = 10
const MAX_SUMMARY = 140

export interface OpportunityLike {
  page: string
  position: number
  ctr: number
  category_median_ctr: number
  potential_clicks: number
  anonymized_share?: number
}

export interface CtrAnomalyLike {
  query: string
  page: string
  ctr_prior: number
  ctr_current: number
  clicks_lost: number
}

export interface HygieneLike {
  url: string
  issue: string
  severity: string
}

export interface HreflangLike {
  page: string
  issue: string
  severity: string
  query?: string
  expected_page?: string
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

/**
 * Drop scheme and host but keep path, query and fragment: the brief already
 * names the site, and hygiene findings need the exact variant.
 */
export function stripOrigin(url: string): string {
  const scheme = url.indexOf('://')
  if (scheme < 0) return url
  const slash = url.indexOf('/', scheme + 3)
  return slash >= 0 ? url.slice(slash) : '/'
}

function clip(s: string): string {
  return s.length <= MAX_SUMMARY ? s : `${s.slice(0, MAX_SUMMARY - 1)}…`
}

export function opportunityFinding(o: OpportunityLike): Finding {
  const tail = o.anonymized_share !== undefined && o.anonymized_share >= 0.5 ? '; mostly long-tail' : ''
  return {
    source: 'opportunities',
    summary: clip(`pos ${o.position.toFixed(1)}, CTR ${pct(o.ctr)} vs ${pct(o.category_median_ctr)} expected${tail}`),
    page: stripOrigin(o.page),
    impact: o.potential_clicks,
  }
}

export function ctrAnomalyFinding(a: CtrAnomalyLike): Finding {
  return {
    source: 'ctr_anomaly',
    summary: clip(`"${a.query}": CTR ${pct(a.ctr_prior)} → ${pct(a.ctr_current)} at stable rank`),
    page: stripOrigin(a.page),
    impact: a.clicks_lost,
  }
}

export function hygieneFinding(h: HygieneLike): Finding {
  return { source: 'url_hygiene', summary: `${h.issue}: should not be indexed`, page: stripOrigin(h.url), impact: null }
}

export function hreflangFinding(h: HreflangLike): Finding {
  const summary =
    h.issue === 'cross_language_ranking' && h.query
      ? `"${h.query}" ranks on the wrong-language page; ${h.expected_page ? stripOrigin(h.expected_page) : 'the translation'} should`
      : `hreflang ${h.issue}`
  return { source: 'hreflang', summary: clip(summary), page: stripOrigin(h.page), impact: null }
}

/** Order by impact desc (nulls last, stable), capped at MAX_FINDINGS. */
export function digestFindings(findings: Finding[]): Finding[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const ai = a.f.impact
      const bi = b.f.impact
      if (ai === null && bi === null) return a.i - b.i
      if (ai === null) return 1
      if (bi === null) return -1
      return bi - ai || a.i - b.i
    })
    .slice(0, MAX_FINDINGS)
    .map(({ f }) => f)
}

// ============================================================================
// Helpers
// ============================================================================

export function round4(n: number): number {
  return Number(n.toFixed(4))
}

/** Round to 4 significant digits — keeps briefs compact without losing signal. */
export function sig4(n: number): number {
  return n === 0 || !Number.isFinite(n) ? n : Number(n.toPrecision(4))
}
