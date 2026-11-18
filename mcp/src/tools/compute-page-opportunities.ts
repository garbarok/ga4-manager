/**
 * Pure scoring for page_opportunities: Search Console pages ranking in a
 * position band (default 4–20) joined with their GA4 organic landing-page
 * outcomes (OpenSEO get_search_opportunities).
 *
 *   score = round(100 × (0.5 × demand + 0.3 × business_value + 0.2 × reachability))
 *
 * demand          log-scaled impressions relative to the largest candidate
 * business_value  session key-event rate relative to the best matched page;
 *                 engagement rate when the property records no key events.
 *                 Each page's rate is shrunk toward the site average with a
 *                 prior of PRIOR_SESSIONS sessions, so a page with 1 session
 *                 and a 100% rate does not outrank one with 300 sessions.
 * reachability    1 at the band's top position, 0 at its bottom
 *
 * Pages with no GA4 match stay in the result with score null, so a reader
 * sees the demand even when outcomes are unknown.
 */

export interface GscPageRow {
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface Ga4LandingRow {
  landing_page: string
  sessions: number
  engaged_sessions: number
  engagement_rate: number
  key_events: number
  session_key_event_rate: number
  revenue: number
}

export interface ScoringOptions {
  min_position: number
  max_position: number
  min_impressions: number
}

export type BusinessValueBasis = 'key_event_rate' | 'engagement_rate'

export interface PageOpportunity {
  page: string
  path: string
  score: number | null
  components: { demand: number; business_value: number | null; reachability: number } | null
  gsc: { clicks: number; impressions: number; ctr: number; position: number }
  ga4: { sessions: number; engagement_rate: number; key_events: number; session_key_event_rate: number; revenue: number } | null
  /** Extra clicks if the page reached the CTR of position 3 (10%), from today's impressions. */
  potential_clicks: number
  unmatched_reason?: string
}

export interface Coverage {
  gsc_pages_total: number
  rows_considered: number
  matched: number
  unmatched: number
  ga4_landing_pages: number
}

export interface ScoredResult {
  opportunities: PageOpportunity[]
  coverage: Coverage
  business_value_basis: BusinessValueBasis
  warnings: string[]
}

const POSITION_3_CTR = 0.1
/** Weight of the site-average rate when smoothing a page's rate (in sessions). */
export const PRIOR_SESSIONS = 10

/**
 * Join key: the path without query string or fragment, decoded, lowercased,
 * without a trailing slash (except root). GSC reports absolute URLs and GA4
 * reports paths, so the host is dropped.
 */
export function pathKey(urlOrPath: string): string {
  let path = urlOrPath.trim()
  try {
    path = new URL(path, 'https://placeholder.invalid').pathname
  } catch {
    path = path.replace(/[?#].*$/, '')
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    // keep the raw path
  }
  path = path.toLowerCase().replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
const r3 = (n: number): number => Math.round(n * 1000) / 1000

export function scoreOpportunities(gsc: GscPageRow[], ga4: Ga4LandingRow[], opts: ScoringOptions): ScoredResult {
  const warnings: string[] = []

  // GA4 rows merged by path (landing pages with different query strings collapse).
  const byPath = new Map<string, Ga4LandingRow>()
  for (const r of ga4) {
    const key = pathKey(r.landing_page)
    const prev = byPath.get(key)
    if (!prev) byPath.set(key, { ...r })
    else {
      const sessions = prev.sessions + r.sessions
      const keyEvents = prev.key_events + r.key_events
      const engaged = prev.engaged_sessions + r.engaged_sessions
      byPath.set(key, {
        landing_page: prev.landing_page,
        sessions,
        engaged_sessions: engaged,
        engagement_rate: sessions ? engaged / sessions : 0,
        key_events: keyEvents,
        session_key_event_rate: sessions ? (prev.session_key_event_rate * prev.sessions + r.session_key_event_rate * r.sessions) / sessions : 0,
        revenue: prev.revenue + r.revenue,
      })
    }
  }

  const hosts = new Set<string>()
  for (const r of gsc) {
    try {
      hosts.add(new URL(r.page).hostname)
    } catch {
      // relative or malformed: ignore for the host check
    }
  }
  if (hosts.size > 1) {
    warnings.push(
      `Search Console reports ${hosts.size} hosts (${[...hosts].slice(0, 3).join(', ')}${hosts.size > 3 ? ', …' : ''}); GA4 landing pages have no host, so pages with the same path on different hosts share one GA4 row.`,
    )
  }

  const candidates = gsc.filter((r) => r.position >= opts.min_position && r.position <= opts.max_position && r.impressions >= opts.min_impressions)
  const anyKeyEvents = [...byPath.values()].some((r) => r.key_events > 0)
  const basis: BusinessValueBasis = anyKeyEvents ? 'key_event_rate' : 'engagement_rate'
  if (ga4.length === 0) {
    warnings.push('GA4 has no organic landing pages in this window: every page is unmatched and unscored. Check that the property records Organic Search sessions (ga4_measurement_health).')
  } else if (!anyKeyEvents) {
    warnings.push('The property recorded no key events on organic landing pages in this window: business value uses engagement rate instead. Mark your conversion events as key events in GA4.')
  }

  const maxImpr = Math.max(1, ...candidates.map((c) => c.impressions))
  const matchedRows = candidates.map((c) => byPath.get(pathKey(c.page))).filter((r): r is Ga4LandingRow => r !== undefined && r.sessions > 0)
  const rawRate = (r: Ga4LandingRow): number => (basis === 'key_event_rate' ? r.session_key_event_rate : r.engagement_rate)
  const totalSessions = matchedRows.reduce((a, r) => a + r.sessions, 0)
  const siteRate = totalSessions ? matchedRows.reduce((a, r) => a + rawRate(r) * r.sessions, 0) / totalSessions : 0
  const valueOf = (r: Ga4LandingRow): number => (rawRate(r) * r.sessions + siteRate * PRIOR_SESSIONS) / (r.sessions + PRIOR_SESSIONS)
  const maxValue = Math.max(0, ...matchedRows.map(valueOf))
  const band = Math.max(1e-9, opts.max_position - opts.min_position)

  const opportunities = candidates.map((c): PageOpportunity => {
    const ga = byPath.get(pathKey(c.page))
    const demand = clamp01(Math.log10(1 + c.impressions) / Math.log10(1 + maxImpr))
    const reachability = clamp01((opts.max_position - c.position) / band)
    const potential = Math.max(0, Math.round(c.impressions * (POSITION_3_CTR - c.ctr)))
    const gscOut = { clicks: c.clicks, impressions: c.impressions, ctr: r3(c.ctr), position: Math.round(c.position * 10) / 10 }
    if (!ga || ga.sessions <= 0) {
      return {
        page: c.page,
        path: pathKey(c.page),
        score: null,
        components: null,
        gsc: gscOut,
        ga4: null,
        potential_clicks: potential,
        unmatched_reason: ga ? 'GA4 recorded the landing page but no organic sessions' : 'No GA4 organic landing-page sessions for this path',
      }
    }
    const value = maxValue > 0 ? clamp01(valueOf(ga) / maxValue) : 0
    return {
      page: c.page,
      path: pathKey(c.page),
      score: Math.round(100 * (0.5 * demand + 0.3 * value + 0.2 * reachability)),
      components: { demand: r3(demand), business_value: r3(value), reachability: r3(reachability) },
      gsc: gscOut,
      ga4: {
        sessions: ga.sessions,
        engagement_rate: r3(ga.engagement_rate),
        key_events: ga.key_events,
        session_key_event_rate: r3(ga.session_key_event_rate),
        revenue: Math.round(ga.revenue * 100) / 100,
      },
      potential_clicks: potential,
    }
  })

  // Scored first by score, then unscored by impressions.
  opportunities.sort((a, b) => {
    if (a.score !== null && b.score !== null) return b.score - a.score || b.gsc.impressions - a.gsc.impressions
    if (a.score !== null) return -1
    if (b.score !== null) return 1
    return b.gsc.impressions - a.gsc.impressions
  })

  const matched = opportunities.filter((o) => o.score !== null).length
  if (candidates.length > 0 && matched === 0 && ga4.length > 0) {
    warnings.push('No candidate page matched a GA4 landing page. Paths may differ (trailing slashes, language prefixes, or a different host in GA4).')
  }
  return {
    opportunities,
    coverage: {
      gsc_pages_total: gsc.length,
      rows_considered: candidates.length,
      matched,
      unmatched: candidates.length - matched,
      ga4_landing_pages: byPath.size,
    },
    business_value_basis: basis,
    warnings,
  }
}

/** Offset in hours between two IANA zones at a given instant (b − a). */
export function zoneOffsetHours(a: string, b: string, at: Date = new Date()): number | null {
  const offset = (tz: string): number | null => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at)
      const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
      const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
      if (name === 'GMT') return 0
      if (!m) return null
      const h = Number(m[1])
      return h + Math.sign(h || 1) * (m[2] ? Number(m[2]) / 60 : 0)
    } catch {
      return null
    }
  }
  const oa = offset(a)
  const ob = offset(b)
  return oa === null || ob === null ? null : ob - oa
}
