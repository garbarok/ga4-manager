import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./gsc-traffic-compare.js', () => ({ querySearchAnalytics: vi.fn() }))

import { querySearchAnalytics } from './gsc-traffic-compare.js'
import { runKeywordsSave, runKeywordsList, runKeywordsRemove } from './keyword-workspace.js'
import { runKeywordSuggestions, gscSiteFor, gscWindow, pickGscSuggestions } from './keyword-suggestions.js'
import { runSerpCompetitors, mapCompetitors } from './serp-competitors.js'
import { runSerpLocations, resetLocationCache, matchQuery } from './serp-locations.js'
import { runDomainOverview, summarizeOverview } from './domain-overview.js'
import { resetPriceCache } from '../utils/paid-gate.js'
import { resetSpend } from '../utils/spend-guard.js'
import { StateStore } from '../utils/state-store.js'
import { emptyContext, saveContext } from '../utils/project-context-store.js'
import type { CLIExecutor } from '../cli/executor.js'

// All fixtures are synthetic: example.com is the site, *.example are competitors.

const PRICES = {
  dataforseo_labs: Object.fromEntries(
    ['serp_competitors', 'domain_rank_overview', 'relevant_pages', 'keywords_for_site'].map((k) => [
      k,
      { live: { priority_normal: [{ cost_type: 'per_request', cost: 0.01 }, { cost_type: 'per_result', cost: 0.0001 }] } },
    ]),
  ),
}

function ok(result: unknown[], cost = 0.012) {
  return new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, status_message: 'Ok.', cost, result }] }))
}
const userData = (balance = 10) => ok([{ money: { balance }, price: PRICES }], 0)

/** Route mocked DataForSEO calls by path. */
function route(handlers: Record<string, () => Response>) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    for (const [frag, h] of Object.entries(handlers)) if (u.includes(frag)) return h()
    throw new Error(`unexpected fetch ${u}`)
  })
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ga4-kw-'))
  resetPriceCache()
  resetSpend()
  resetLocationCache()
  vi.stubEnv('DATAFORSEO_USERNAME', 'u')
  vi.stubEnv('DATAFORSEO_PASSWORD', 'p')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('keyword workspace', () => {
  it('upserts: merges tags, replaces note and metrics, normalizes', async () => {
    const a = await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['Best  Widgets', 'widget price'], tags: ['Money Pages'], replace_tags: false })
    expect(a).toMatchObject({ success: true, added: ['best widgets', 'widget price'], updated: [], tags: { 'money-pages': 2 } })
    const b = await runKeywordsSave({
      site: 'https://www.example.com/', state_dir: dir, keywords: ['best widgets'], tags: ['cluster-a'], note: 'hub', metrics: { 'Best Widgets': { volume: 900, kd: 30 } }, replace_tags: false,
    })
    expect(b).toMatchObject({ success: true, added: [], updated: ['best widgets'], total: 2 })
    const list = await runKeywordsList({ site: 'example.com', state_dir: dir, tag: 'cluster-a', sort: 'keyword', limit: 500 })
    expect(list).toMatchObject({ success: true, matched: 1, keywords: [{ keyword: 'best widgets', tags: ['cluster-a', 'money-pages'], note: 'hub', metrics: { volume: 900, kd: 30, cpc: null } }] })
  })

  it('sorts by volume and filters by substring', async () => {
    await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['a widget', 'b widget', 'gadget'], metrics: { 'b widget': { volume: 50 }, 'a widget': { volume: 10 } }, replace_tags: false })
    const out = await runKeywordsList({ site: 'example.com', state_dir: dir, query: 'widget', sort: 'volume', limit: 500 })
    expect(out.success && out.keywords.map((k) => k.keyword)).toEqual(['b widget', 'a widget'])
  })

  it('removes by keyword, by tag, and strips a tag', async () => {
    await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['a', 'b'], tags: ['x'], replace_tags: false })
    await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['c'], tags: ['y', 'x'], replace_tags: false })
    expect(await runKeywordsRemove({ site: 'example.com', state_dir: dir, untag: 'y' })).toMatchObject({ untagged: 1, total: 3 })
    expect(await runKeywordsRemove({ site: 'example.com', state_dir: dir, keywords: ['a'] })).toMatchObject({ removed: ['a'], total: 2 })
    expect(await runKeywordsRemove({ site: 'example.com', state_dir: dir, tag: 'x' })).toMatchObject({ removed: ['b', 'c'], total: 0 })
  })
})

describe('keyword_suggestions', () => {
  const executor = { execute: vi.fn() } as unknown as CLIExecutor
  const rows = [
    { keys: ['widget price'], clicks: 3, impressions: 400, ctr: 0.0075, position: 8.4 },
    { keys: ['best widgets'], clicks: 9, impressions: 900, ctr: 0.01, position: 6 },
    { keys: ['widget brand'], clicks: 80, impressions: 300, ctr: 0.26, position: 1.2 },
    { keys: ['rare widget'], clicks: 0, impressions: 3, ctr: 0, position: 12 },
    { keys: ['widget repair'], clicks: 1, impressions: 150, ctr: 0.0067, position: 22.06 },
  ]

  it('helpers: site normalization, window and selection', () => {
    expect(gscSiteFor('example.com')).toBe('sc-domain:example.com')
    expect(gscSiteFor('https://example.com/')).toBe('https://example.com/')
    expect(gscWindow(7, new Date('2026-01-10T00:00:00Z'))).toEqual({ start: '2026-01-01', end: '2026-01-07' })
    const picked = pickGscSuggestions(rows, new Set(['best widgets']), { min_position: 4, max_position: 30, min_impressions: 10, limit: 50 })
    expect(picked.map((p) => p.keyword)).toEqual(['widget price', 'widget repair'])
    expect(picked[1].position).toBe(22.1)
  })

  it('free path: striking-distance GSC queries not yet saved, no DataForSEO call', async () => {
    vi.mocked(querySearchAnalytics).mockResolvedValue(rows as never)
    const fetchMock = vi.spyOn(global, 'fetch')
    await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['widget price'], replace_tags: false })
    const out = await runKeywordSuggestions(
      { site: 'example.com', state_dir: dir, days: 90, min_position: 4, max_position: 30, min_impressions: 10, limit: 50, include_paid: false, paid_limit: 50, location_name: 'United States', language_code: 'en', max_cost_usd: 0.5, estimate_only: false, refresh_cache: false },
      executor,
    )
    expect(out).toMatchObject({ success: true, gsc_site: 'sc-domain:example.com', already_saved: 1, paid_suggestions: null, cost_usd: 0 })
    expect((out as { gsc_suggestions: { keyword: string }[] }).gsc_suggestions.map((s) => s.keyword)).toEqual(['best widgets', 'widget repair'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('paid path: gated keywords_for_site, flags keywords already in GSC', async () => {
    vi.mocked(querySearchAnalytics).mockResolvedValue(rows as never)
    route({
      user_data: () => userData(),
      keywords_for_site: () =>
        ok([{ items: [
          { keyword: 'Best Widgets', keyword_info: { search_volume: 2400, cpc: 1.1 }, keyword_properties: { keyword_difficulty: 41 }, search_intent_info: { main_intent: 'commercial' } },
          { keyword: 'widget kits', keyword_info: { search_volume: 300 } },
        ] }]),
    })
    const out = await runKeywordSuggestions(
      { site: 'sc-domain:example.com', state_dir: dir, days: 90, min_position: 4, max_position: 30, min_impressions: 10, limit: 50, include_paid: true, paid_limit: 50, location_name: 'United States', language_code: 'en', max_cost_usd: 0.5, estimate_only: false, refresh_cache: false },
      executor,
    )
    expect(out).toMatchObject({
      success: true,
      paid_suggestions: [
        { keyword: 'best widgets', search_volume: 2400, keyword_difficulty: 41, cpc: 1.1, intent: 'commercial', in_gsc: true },
        { keyword: 'widget kits', search_volume: 300, in_gsc: false },
      ],
      estimate: { total_usd: 0.015 },
      cost_usd: 0.012,
    })
  })
})

describe('serp_competitors', () => {
  const ITEMS: Parameters<typeof mapCompetitors>[0] = [
    { domain: 'www.competitor.example', avg_position: 3.456, median_position: 3, etv: 1200.5, keywords_count: 3, visibility: 0.41234, keywords_positions: { a: [3, 7], b: [2], c: [5] } },
    { domain: 'example.com', avg_position: 8, keywords_count: 2, keywords_positions: { a: [8], b: [9] } },
    { domain: 'new-rival.example', avg_position: 12, keywords_count: 2 },
    { domain: 'blog.known.example', avg_position: 15, keywords_count: 1 },
  ]

  it('maps rows, marks site and known competitors', () => {
    const rows = mapCompetitors(ITEMS, 4, 'example.com', new Set(['known.example']))
    expect(rows[0]).toMatchObject({ domain: 'competitor.example', share_of_keywords: 0.75, avg_position: 3.46, visibility: 0.4123, best_positions: { a: 3, b: 2, c: 5 }, is_site: false })
    expect(rows[1].is_site).toBe(true)
    expect(rows[3].is_known_competitor).toBe(true)
  })

  it('reads keywords by tag, gates, and suggests unknown frequent rankers', async () => {
    await runKeywordsSave({ site: 'example.com', state_dir: dir, keywords: ['a', 'b', 'c', 'd'], tags: ['core'], replace_tags: false })
    saveContext(new StateStore(dir), { ...emptyContext('example.com'), competitors: [{ domain: 'known.example' }] })
    let body: unknown = null
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('user_data')) return userData()
      body = JSON.parse(String((init as RequestInit).body))
      return ok([{ items: ITEMS }])
    })
    const out = await runSerpCompetitors({
      site: 'example.com', state_dir: dir, tag: 'core', location_name: 'United States', language_code: 'en', limit: 20, include_subdomains: true, max_cost_usd: 0.5, estimate_only: false, refresh_cache: false,
    })
    expect(body).toEqual([{ keywords: ['a', 'b', 'c', 'd'], location_name: 'United States', language_code: 'en', limit: 20, include_subdomains: true, item_types: ['organic'] }])
    expect(out).toMatchObject({ success: true, keywords_analyzed: 4, site_row: { domain: 'example.com' }, suggested_competitors: ['competitor.example', 'new-rival.example'], cost_usd: 0.012 })
  })

  it('estimate_only spends nothing', async () => {
    const fetchMock = route({ user_data: () => userData() })
    const out = await runSerpCompetitors({
      keywords: ['a'], location_name: 'United States', language_code: 'en', limit: 20, include_subdomains: true, max_cost_usd: 0.5, estimate_only: true, refresh_cache: false,
    })
    expect(out).toMatchObject({ success: true, estimate_only: true, estimate: { total_usd: 0.012 } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a tag with no saved keywords', async () => {
    const out = await runSerpCompetitors({
      site: 'example.com', state_dir: dir, tag: 'none', location_name: 'United States', language_code: 'en', limit: 20, include_subdomains: true, max_cost_usd: 0.5, estimate_only: false, refresh_cache: false,
    })
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })
})

describe('serp_locations', () => {
  const COUNTRIES = [
    { location_code: 2724, location_name: 'Spain', country_iso_code: 'ES', location_type: 'Country', available_languages: [{ language_name: 'Spanish', language_code: 'es' }] },
    { location_code: 2826, location_name: 'United Kingdom', country_iso_code: 'GB', location_type: 'Country', available_languages: [{ language_name: 'English', language_code: 'en' }] },
  ]
  const ES = [
    { location_code: 2724, location_name: 'Spain', location_type: 'Country', country_iso_code: 'ES' },
    { location_code: 1005424, location_name: 'Madrid,Community of Madrid,Spain', location_code_parent: 20817, location_type: 'City', country_iso_code: 'ES' },
  ]

  it('matches every query word', () => {
    expect(matchQuery('United Kingdom', 'united king')).toBe(true)
    expect(matchQuery('Spain', 'united')).toBe(false)
  })

  it('filters countries and caches lists in memory; regions need a country', async () => {
    const fetchMock = route({ locations_and_languages: () => ok(COUNTRIES, 0), 'locations/es': () => ok(ES, 0) })
    expect(await runSerpLocations({ query: 'kingdom', include_regions: false, limit: 25 })).toMatchObject({
      success: true, countries: [{ location_code: 2826, languages: [{ language_code: 'en' }] }], regions: null, cost_usd: 0,
    })
    const regions = await runSerpLocations({ country_iso_code: 'es', include_regions: true, query: 'madrid', limit: 25 })
    expect(regions).toMatchObject({ success: true, countries: [{ location_code: 2724 }], regions: [{ location_code: 1005424, location_type: 'City' }] })
    await runSerpLocations({ include_regions: false, limit: 25 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await runSerpLocations({ include_regions: true, limit: 25 })).toMatchObject({ success: false })
  })
})

describe('domain_overview', () => {
  const OVERVIEW = [{ items: [{ metrics: { organic: { pos_1: 10, pos_2_3: 20, pos_4_10: 30, pos_11_20: 5, etv: 1234.6, count: 70, estimated_paid_traffic_cost: 999.4, is_new: 3, is_lost: 1 }, paid: { etv: 0, count: 0 } } }] }]
  const PAGES = [{ items: [{ page_address: 'https://example.com/a', metrics: { organic: { etv: 500.2, count: 12, pos_1: 2, pos_2_3: 1, pos_4_10: 4 } } }] }]

  it('summarizes bands', () => {
    const s = summarizeOverview(OVERVIEW[0].items[0])
    expect(s.organic).toMatchObject({ estimated_traffic: 1235, keywords: 70, top_3: 30, top_10: 60, traffic_value_usd: 999, movement: { new: 3, up: 0, down: 0, lost: 1 } })
  })

  it('buys overview + top pages behind the gate', async () => {
    route({ user_data: () => userData(), domain_rank_overview: () => ok(OVERVIEW), relevant_pages: () => ok(PAGES) })
    const out = await runDomainOverview({ domain: 'https://www.example.com/', location_name: 'United States', language_code: 'en', include_pages: true, pages_limit: 10, max_cost_usd: 0.5, estimate_only: false, refresh_cache: false })
    expect(out).toMatchObject({
      success: true, domain: 'example.com',
      organic: { estimated_traffic: 1235 },
      top_pages: [{ url: 'https://example.com/a', estimated_traffic: 500, keywords: 12, top_3: 3, top_10: 7 }],
      estimate: { total_usd: 0.0211 }, cost_usd: 0.024, warnings: [],
    })
  })

  it('reports a missing overview as a warning, not an error', async () => {
    route({ user_data: () => userData(), domain_rank_overview: () => ok([{ items: [] }]) })
    const out = await runDomainOverview({ domain: 'example.com', location_name: 'United States', language_code: 'en', include_pages: false, pages_limit: 10, max_cost_usd: 0.5, estimate_only: false, refresh_cache: false })
    expect(out).toMatchObject({ success: true, top_pages: null, organic: { keywords: 0 } })
    expect((out as { warnings: string[] }).warnings[0]).toMatch(/no ranking data/)
  })
})

describe('serp_competitors platforms (B16)', () => {
  it('flags platforms so they are not suggested as competitors', async () => {
    const { isPlatform } = await import('./serp-competitors.js')
    expect(isPlatform('www.youtube.com')).toBe(true)
    expect(isPlatform('es.wikipedia.org')).toBe(true)
    expect(isPlatform('amazon.it')).toBe(true)
    expect(isPlatform('news.example.org')).toBe(false)
  })
})
