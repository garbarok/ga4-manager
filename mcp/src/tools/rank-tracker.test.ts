import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  itemHost, parseSerpForSite, compareRuns, buildHistory, applyKeywordOps, newTracker, planRun,
  type SerpItem, type RankRun, type KeywordRank,
} from './rank-tracker-core.js'
import {
  runRankTrackerCreate, runRankTrackerUpdate, runRankTrackerGet, runRankTrackerHistory, runRankTrackerList,
  runRankTrackerDelete, runRankTrackerEstimate, runRankTrackerRun,
} from './rank-tracker.js'
import { resetPriceCache } from '../utils/paid-gate.js'
import { resetSpend } from '../utils/spend-guard.js'

// Synthetic SERP: no real sites. The second organic result uses DataForSEO's
// google.com/goto wrapper, whose real host is only in the breadcrumb.
const SERP_ITEMS: SerpItem[] = [
  {
    type: 'ai_overview',
    rank_group: 1,
    rank_absolute: 1,
    references: [
      { domain: 'competitor.example', url: 'https://competitor.example/guide' },
      { domain: 'www.example.com', url: 'https://www.example.com/pricing' },
    ],
  },
  { type: 'organic', rank_group: 1, rank_absolute: 2, domain: 'competitor.example', url: 'https://competitor.example/guide' },
  {
    type: 'organic',
    rank_group: 2,
    rank_absolute: 3,
    domain: 'google.com',
    url: 'https://google.com/goto?url=abc',
    breadcrumb: 'https://other.example › blog › post',
  },
  { type: 'people_also_ask', rank_group: 1, rank_absolute: 4 },
  { type: 'organic', rank_group: 3, rank_absolute: 5, domain: 'blog.example.com', url: 'https://blog.example.com/post' },
  { type: 'organic', rank_group: 4, rank_absolute: 6, domain: 'third.example', url: 'https://third.example/' },
  { type: 'organic', rank_group: 5, rank_absolute: 7, domain: 'fourth.example', url: 'https://fourth.example/' },
]

function serpResponse(items: SerpItem[], cost = 0.02) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, status_message: 'Ok.', cost, result: [{ keyword: 'k', items }] }] }),
  )
}

function userData(balance = 10) {
  const tree = { serp: { live: { advanced: { priority_normal: [{ cost_type: 'per_request', cost: 0.002 }] } } } }
  return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance }, price: tree }] }] }))
}

describe('SERP parsing', () => {
  it('resolves wrapped google.com/goto results through the breadcrumb', () => {
    expect(itemHost({ domain: 'google.com', url: 'https://google.com/goto?url=x', breadcrumb: 'https://dev.example › a' })).toBe('dev.example')
    expect(itemHost({ domain: 'shop.example', url: 'https://shop.example/x' })).toBe('shop.example')
  })

  it('finds the site (subdomain-insensitive), features, AI Overview citation and competitors', () => {
    const r = parseSerpForSite('kw', SERP_ITEMS, 'example.com')
    expect(r.position).toBe(3)
    expect(r.rank_absolute).toBe(5)
    expect(r.url).toBe('https://blog.example.com/post')
    expect(r.serp_features).toEqual(['ai_overview', 'people_also_ask'])
    expect(r.ai_overview).toEqual({ present: true, site_cited: true, cited_url: 'https://www.example.com/pricing' })
    expect(r.competitors.map((c) => c.domain)).toEqual(['competitor.example', 'other.example', 'third.example'])
  })

  it('reports unranked and no overview', () => {
    const r = parseSerpForSite('kw', SERP_ITEMS.filter((i) => i.type === 'organic' && i.domain !== 'blog.example.com'), 'example.com')
    expect(r.position).toBeNull()
    expect(r.ai_overview).toEqual({ present: false, site_cited: null, cited_url: null })
  })
})

describe('tracker model', () => {
  const now = new Date('2026-01-01T00:00:00Z')
  it('normalizes, dedupes, pins and removes keywords', () => {
    let t = newTracker({ site: 'https://www.example.com/', keywords: ['Alpha  Beta', 'alpha beta', 'gamma'], pinned: ['delta'], language_code: 'en', device: 'desktop', depth: 20 }, now)
    expect(t.site).toBe('example.com')
    expect(t.location_name).toBe('United States')
    expect(t.keywords.map((k) => [k.keyword, k.pinned])).toEqual([['alpha beta', false], ['gamma', false], ['delta', true]])
    t = applyKeywordOps(t, { remove: ['gamma'], unpin: ['delta'], pin: ['alpha beta'] }, now)
    expect(t.keywords.map((k) => [k.keyword, k.pinned])).toEqual([['alpha beta', true], ['delta', false]])
    expect(planRun(t)[0]).toEqual({
      path: 'serp/google/organic/live/advanced',
      task: { keyword: 'alpha beta', location_name: 'United States', language_code: 'en', device: 'desktop', depth: 20 },
    })
  })

  it('compares runs: up, down, new, lost, first_run', () => {
    const rank = (keyword: string, position: number | null): KeywordRank => ({
      keyword, position, rank_absolute: position, url: null, serp_features: [], ai_overview: { present: false, site_cited: null, cited_url: null }, competitors: [],
    })
    const prev = { id: 'r1', ran_at: '2026-01-01T00:00:00Z', results: [rank('a', 5), rank('b', 3), rank('c', null), rank('d', 4)] } as RankRun
    const cmp = compareRuns(prev, [rank('a', 2), rank('b', 7), rank('c', 9), rank('d', null), rank('e', 1)])
    expect(cmp.changes.map((c) => [c.keyword, c.status, c.delta])).toEqual([
      ['a', 'up', 3], ['b', 'down', -4], ['c', 'new', null], ['d', 'lost', null], ['e', 'first_run', null],
    ])
    expect(cmp.summary).toEqual({ up: 1, down: 1, same: 0, new: 1, lost: 1, unranked: 0 })
    expect(compareRuns(null, [rank('a', 1)]).changes[0].status).toBe('first_run')
  })

  it('builds history oldest first with best and latest, pinned first', () => {
    const t = newTracker({ site: 'example.com', keywords: ['a', 'b'], pinned: ['b'], language_code: 'en', device: 'mobile', depth: 10 }, now)
    const mk = (id: string, at: string, a: number | null, b: number | null) =>
      ({ id, ran_at: at, results: [{ keyword: 'a', position: a, url: null }, { keyword: 'b', position: b, url: null }] }) as unknown as RankRun
    const h = buildHistory(t, [mk('r2', '2026-02-01', 4, null), mk('r1', '2026-01-01', 6, 2)])
    expect(h.map((x) => x.keyword)).toEqual(['b', 'a'])
    expect(h[1]).toMatchObject({ best: 4, latest: 4, points: [{ run_id: 'r1', position: 6 }, { run_id: 'r2', position: 4 }] })
    expect(h[0]).toMatchObject({ best: 2, latest: null })
  })
})

describe('rank tracker tools', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ga4-rank-'))
    resetPriceCache()
    resetSpend()
    vi.stubEnv('DATAFORSEO_USERNAME', 'u')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function create(extra: Record<string, unknown> = {}) {
    const out = await runRankTrackerCreate({
      site: 'example.com', state_dir: dir, keywords: ['alpha', 'beta'], language_code: 'en', device: 'desktop', depth: 20, ...extra,
    } as never)
    if (!out.success) throw new Error(JSON.stringify(out))
    return out.tracker
  }

  it('creates, lists, updates and resolves the only tracker without an id', async () => {
    const t = await create()
    const list = await runRankTrackerList({ site: 'example.com', state_dir: dir })
    expect(list).toMatchObject({ success: true, trackers: [{ id: t.id, keywords: 2, last_run_at: null }] })
    const upd = await runRankTrackerUpdate({ site: 'example.com', state_dir: dir, add: ['gamma'], pin: ['beta'], name: 'Main' })
    expect(upd).toMatchObject({ success: true, added: ['gamma'], removed: [] })
    const got = await runRankTrackerGet({ site: 'example.com', state_dir: dir })
    expect(got).toMatchObject({ success: true, tracker: { name: 'Main' }, latest_run: null, not_yet_checked: ['alpha', 'beta', 'gamma'] })
  })

  it('asks for tracker_id when a site has several', async () => {
    await create()
    await create({ device: 'mobile' })
    const got = await runRankTrackerGet({ site: 'example.com', state_dir: dir })
    expect(got).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })

  it('estimate is free and priced per 10 results of depth', async () => {
    await create()
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => userData())
    const out = await runRankTrackerEstimate({ site: 'example.com', state_dir: dir })
    expect(out).toMatchObject({ success: true, keywords: 2, estimate: { total_usd: 0.008 }, balance_usd: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('run: gate refuses above max_cost_usd without buying', async () => {
    await create({ depth: 100 })
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async () => userData())
    const out = await runRankTrackerRun({ site: 'example.com', state_dir: dir, max_cost_usd: 0.01, estimate_only: false, refresh_cache: false })
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('run: buys one SERP per keyword, stores the run, compares with the previous one, keeps history', async () => {
    const t = await create()
    let serpCalls = 0
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('user_data')) return userData()
      serpCalls += 1
      return serpResponse(SERP_ITEMS, 0.004)
    })
    const first = await runRankTrackerRun({ site: 'example.com', state_dir: dir, max_cost_usd: 1, estimate_only: false, refresh_cache: false }, new Date('2026-01-01T00:00:00Z'))
    expect(first).toMatchObject({ success: true, cost_usd: 0.008, errors: 0, estimate: { total_usd: 0.008 } })
    expect(serpCalls).toBe(2)

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('user_data')) return userData()
      return serpResponse(SERP_ITEMS.filter((i) => i.domain !== 'blog.example.com'), 0.004)
    })
    const second = await runRankTrackerRun({ site: 'example.com', state_dir: dir, keywords: ['alpha'], max_cost_usd: 1, estimate_only: false, refresh_cache: false }, new Date('2026-01-02T00:00:00Z'))
    expect(second).toMatchObject({ success: true, comparison: { summary: { lost: 1 }, changes: [{ keyword: 'alpha', previous: 3, current: null, status: 'lost' }] } })

    const hist = await runRankTrackerHistory({ site: 'example.com', state_dir: dir, tracker_id: t.id, max_runs: 30 })
    expect(hist).toMatchObject({ success: true, runs: 2 })
    if (hist.success) expect(hist.keywords.find((k) => k.keyword === 'alpha')).toMatchObject({ best: 3, latest: null })

    const got = await runRankTrackerGet({ site: 'example.com', state_dir: dir })
    expect(got).toMatchObject({ success: true, run_count: 2, latest_run: { ran_at: '2026-01-02T00:00:00.000Z' } })

    const del = await runRankTrackerDelete({ site: 'example.com', state_dir: dir, tracker_id: t.id, keep_runs: false })
    expect(del).toMatchObject({ success: true, runs_deleted: 2 })
    expect(await runRankTrackerList({ site: 'example.com', state_dir: dir })).toMatchObject({ trackers: [] })
  })

  it('run: per-keyword failures are reported, all-failed is an error', async () => {
    await create()
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('user_data')) return userData()
      return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field', cost: 0 }] }))
    })
    const out = await runRankTrackerRun({ site: 'example.com', state_dir: dir, max_cost_usd: 1, estimate_only: false, refresh_cache: false })
    expect(out).toMatchObject({ success: false })
  })
})
