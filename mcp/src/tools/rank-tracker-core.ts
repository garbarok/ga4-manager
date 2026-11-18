// ============================================================================
// rank-tracker-core.ts — pure rank-tracker model: trackers, runs, SERP parsing,
// run-to-run comparison and history. No I/O except through StateStore.
// ============================================================================

import { StateStore, siteKey, newId } from '../utils/state-store.js'
import type { PlannedRequest } from '../utils/paid-gate.js'

export const TRACKERS = 'rank-trackers'
export const RUNS = 'rank-runs'
export const SERP_PATH = 'serp/google/organic/live/advanced'
export const MAX_TRACKER_KEYWORDS = 500

export type Device = 'desktop' | 'mobile'

export interface TrackedKeyword {
  keyword: string
  pinned: boolean
  added_at: string
}

export interface Tracker {
  id: string
  site: string
  name: string
  location_code: number | null
  location_name: string | null
  language_code: string
  device: Device
  depth: number
  keywords: TrackedKeyword[]
  created_at: string
  updated_at: string
}

export interface Competitor {
  position: number
  domain: string
  url: string
}

export interface KeywordRank {
  keyword: string
  /** rank_group of the site's first organic result; null when not in the scanned depth. */
  position: number | null
  rank_absolute: number | null
  url: string | null
  serp_features: string[]
  ai_overview: { present: boolean; site_cited: boolean | null; cited_url: string | null }
  /** The top 3 organic results that are not the site. */
  competitors: Competitor[]
  error?: string
}

export interface RankRun {
  id: string
  tracker_id: string
  site: string
  ran_at: string
  location_code: number | null
  location_name: string | null
  language_code: string
  device: Device
  depth: number
  results: KeywordRank[]
  cost_usd: number | null
  estimate_usd: number
}

export interface KeywordChange {
  keyword: string
  previous: number | null
  current: number | null
  /** Positive = moved up (better). null when either side is unranked. */
  delta: number | null
  status: 'new' | 'lost' | 'up' | 'down' | 'same' | 'unranked' | 'first_run'
}

export interface RunComparison {
  previous_run_id: string | null
  previous_ran_at: string | null
  changes: KeywordChange[]
  summary: { up: number; down: number; same: number; new: number; lost: number; unranked: number }
}

// ----------------------------------------------------------------------------
// Keywords and trackers
// ----------------------------------------------------------------------------

export function normalizeKeyword(k: string): string {
  return k.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function newTracker(
  input: {
    site: string
    name?: string
    keywords: string[]
    pinned?: string[]
    location_code?: number
    location_name?: string
    language_code: string
    device: Device
    depth: number
  },
  now: Date = new Date(),
): Tracker {
  const at = now.toISOString()
  const site = siteKey(input.site)
  const tracker: Tracker = {
    id: newId(now),
    site,
    name: input.name?.trim() || `${site} ${input.device}`,
    location_code: input.location_code ?? null,
    location_name: input.location_code ? null : (input.location_name ?? 'United States'),
    language_code: input.language_code,
    device: input.device,
    depth: input.depth,
    keywords: [],
    created_at: at,
    updated_at: at,
  }
  return applyKeywordOps(tracker, { add: input.keywords, pin: input.pinned ?? [] }, now)
}

export interface KeywordOps {
  add?: string[]
  remove?: string[]
  pin?: string[]
  unpin?: string[]
}

/** Add, remove, pin and unpin keywords. Adding an existing keyword is a no-op; pinning a missing one adds it. */
export function applyKeywordOps(tracker: Tracker, ops: KeywordOps, now: Date = new Date()): Tracker {
  const at = now.toISOString()
  const byKey = new Map(tracker.keywords.map((k) => [normalizeKeyword(k.keyword), { ...k }]))
  for (const k of [...(ops.add ?? []), ...(ops.pin ?? [])]) {
    const key = normalizeKeyword(k)
    if (!key || byKey.has(key)) continue
    byKey.set(key, { keyword: key, pinned: false, added_at: at })
  }
  for (const k of ops.remove ?? []) byKey.delete(normalizeKeyword(k))
  for (const k of ops.pin ?? []) {
    const entry = byKey.get(normalizeKeyword(k))
    if (entry) entry.pinned = true
  }
  for (const k of ops.unpin ?? []) {
    const entry = byKey.get(normalizeKeyword(k))
    if (entry) entry.pinned = false
  }
  return { ...tracker, keywords: [...byKey.values()], updated_at: at }
}

/** Pinned keywords first, then alphabetical. */
export function sortKeywords<T extends { keyword: string }>(items: T[], pinned: Set<string>): T[] {
  return [...items].sort((a, b) => Number(pinned.has(b.keyword)) - Number(pinned.has(a.keyword)) || a.keyword.localeCompare(b.keyword))
}

export function serpTask(tracker: Tracker, keyword: string): Record<string, unknown> {
  return {
    keyword,
    ...(tracker.location_code ? { location_code: tracker.location_code } : { location_name: tracker.location_name }),
    language_code: tracker.language_code,
    device: tracker.device,
    depth: tracker.depth,
  }
}

export function planRun(tracker: Tracker, keywords?: string[]): PlannedRequest[] {
  const subset = keywords?.length ? new Set(keywords.map(normalizeKeyword)) : null
  return tracker.keywords
    .filter((k) => !subset || subset.has(k.keyword))
    .map((k) => ({ path: SERP_PATH, task: serpTask(tracker, k.keyword) }))
}

// ----------------------------------------------------------------------------
// SERP parsing
// ----------------------------------------------------------------------------

export interface SerpItem {
  type: string
  rank_group?: number
  rank_absolute?: number
  domain?: string | null
  url?: string | null
  breadcrumb?: string | null
  references?: { domain?: string | null; url?: string | null; source?: string | null }[] | null
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The real host of a SERP item. DataForSEO sometimes reports `domain:
 * "google.com"` with a `google.com/goto?url=...` redirect URL; the result's
 * own host is then only in the breadcrumb ("https://dev.to › path").
 */
export function itemHost(item: { domain?: string | null; url?: string | null; breadcrumb?: string | null }): string | null {
  const urlHost = hostOf(item.url)
  const wrapped = urlHost === 'google.com' || urlHost === 'www.google.com' || /\/goto\?/.test(item.url ?? '')
  if (wrapped && item.breadcrumb) {
    const crumbHost = hostOf(item.breadcrumb.split(' › ')[0]?.trim())
    if (crumbHost) return crumbHost
  }
  if (!wrapped && urlHost) return urlHost
  return item.domain?.toLowerCase() ?? urlHost
}

export function hostMatches(host: string | null, site: string): boolean {
  if (!host) return false
  const h = host.replace(/^www\./, '')
  return h === site || h.endsWith(`.${site}`)
}

export function parseSerpForSite(keyword: string, items: SerpItem[], site: string): KeywordRank {
  const organic = items.filter((i) => i.type === 'organic')
  const own = organic.find((i) => hostMatches(itemHost(i), site))
  const features = [...new Set(items.map((i) => i.type).filter((t) => t !== 'organic'))].sort()
  const overview = items.find((i) => i.type === 'ai_overview')
  let aiOverview: KeywordRank['ai_overview'] = { present: false, site_cited: null, cited_url: null }
  if (overview) {
    const refs = overview.references ?? []
    const cited = refs.find((r) => hostMatches(itemHost({ domain: r.domain, url: r.url }), site))
    aiOverview = { present: true, site_cited: refs.length ? Boolean(cited) : null, cited_url: cited?.url ?? null }
  }
  const competitors = organic
    .filter((i) => i !== own && !hostMatches(itemHost(i), site))
    .slice(0, 3)
    .map((i) => ({ position: i.rank_group ?? 0, domain: (itemHost(i) ?? '').replace(/^www\./, ''), url: i.url ?? '' }))
  return {
    keyword,
    position: own?.rank_group ?? null,
    rank_absolute: own?.rank_absolute ?? null,
    url: own?.url ?? null,
    serp_features: features,
    ai_overview: aiOverview,
    competitors,
  }
}

// ----------------------------------------------------------------------------
// Comparison and history
// ----------------------------------------------------------------------------

export function compareRuns(previous: RankRun | null, current: KeywordRank[]): RunComparison {
  const prev = new Map((previous?.results ?? []).filter((r) => !r.error).map((r) => [r.keyword, r.position]))
  const summary = { up: 0, down: 0, same: 0, new: 0, lost: 0, unranked: 0 }
  const changes: KeywordChange[] = current
    .filter((r) => !r.error)
    .map((r) => {
      const had = prev.has(r.keyword)
      const before = had ? (prev.get(r.keyword) ?? null) : null
      const now = r.position
      let status: KeywordChange['status']
      let delta: number | null = null
      if (!previous || !had) status = 'first_run'
      else if (before === null && now === null) status = 'unranked'
      else if (before === null) status = 'new'
      else if (now === null) status = 'lost'
      else {
        delta = before - now
        status = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'
      }
      if (status !== 'first_run') summary[status] += 1
      return { keyword: r.keyword, previous: before, current: now, delta, status }
    })
  return { previous_run_id: previous?.id ?? null, previous_ran_at: previous?.ran_at ?? null, changes, summary }
}

export interface HistoryPoint {
  run_id: string
  ran_at: string
  position: number | null
  url: string | null
}

export interface KeywordHistory {
  keyword: string
  pinned: boolean
  points: HistoryPoint[]
  best: number | null
  latest: number | null
}

/** Positions per keyword across runs, oldest first. */
export function buildHistory(tracker: Tracker, runs: RankRun[], keywords?: string[]): KeywordHistory[] {
  const ordered = [...runs].sort((a, b) => a.ran_at.localeCompare(b.ran_at))
  const wanted = keywords?.length ? new Set(keywords.map(normalizeKeyword)) : null
  const pinned = new Set(tracker.keywords.filter((k) => k.pinned).map((k) => k.keyword))
  const list = tracker.keywords.filter((k) => !wanted || wanted.has(k.keyword))
  const histories = list.map((k): KeywordHistory => {
    const points: HistoryPoint[] = []
    for (const run of ordered) {
      const r = run.results.find((x) => x.keyword === k.keyword && !x.error)
      if (r) points.push({ run_id: run.id, ran_at: run.ran_at, position: r.position, url: r.url })
    }
    const ranked = points.map((p) => p.position).filter((p): p is number => p !== null)
    return {
      keyword: k.keyword,
      pinned: k.pinned,
      points,
      best: ranked.length ? Math.min(...ranked) : null,
      latest: points.length ? points[points.length - 1].position : null,
    }
  })
  return sortKeywords(histories, pinned)
}

// ----------------------------------------------------------------------------
// Storage
// ----------------------------------------------------------------------------

export function loadTracker(store: StateStore, site: string, id: string): Tracker | null {
  return store.readRecord<Tracker>(TRACKERS, site, id)?.data ?? null
}

export function saveTracker(store: StateStore, tracker: Tracker): void {
  store.writeRecord(TRACKERS, tracker.site, tracker.id, tracker, new Date(tracker.updated_at))
}

export function listTrackers(store: StateStore, site: string): Tracker[] {
  return store
    .listRecordIds(TRACKERS, site)
    .map((id) => loadTracker(store, site, id))
    .filter((t): t is Tracker => t !== null)
}

export function listRuns(store: StateStore, site: string, trackerId: string): RankRun[] {
  return store
    .listRecordIds(RUNS, site)
    .map((id) => store.readRecord<RankRun>(RUNS, site, id)?.data ?? null)
    .filter((r): r is RankRun => r !== null && r.tracker_id === trackerId)
}

export function latestRun(store: StateStore, site: string, trackerId: string): RankRun | null {
  const runs = listRuns(store, site, trackerId)
  return runs.sort((a, b) => b.ran_at.localeCompare(a.ran_at))[0] ?? null
}
