import { describe, it, expect, vi, afterEach } from 'vitest'
import { pathKey, scoreOpportunities, zoneOffsetHours, PRIOR_SESSIONS, type Ga4LandingRow, type GscPageRow } from './compute-page-opportunities.js'
import { joinWindow, runPageOpportunities } from './page-opportunities.js'
import { latestDate } from '../utils/gsc-data-through.js'
import { CLIExecutor } from '../cli/executor.js'

vi.mock('../utils/google-auth.js', () => ({ getGoogleAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))

const OPTS = { min_position: 4, max_position: 20, min_impressions: 50 }

const gscRow = (path: string, impressions: number, position: number, clicks = 5): GscPageRow => ({
  page: `https://example.com${path}`,
  clicks,
  impressions,
  ctr: clicks / impressions,
  position,
})
const ga4Row = (path: string, sessions: number, keyRate: number, engagement = 0.5): Ga4LandingRow => ({
  landing_page: path,
  sessions,
  engaged_sessions: Math.round(sessions * engagement),
  engagement_rate: engagement,
  key_events: Math.round(sessions * keyRate),
  session_key_event_rate: keyRate,
  revenue: 0,
})

describe('pathKey', () => {
  it.each([
    ['https://example.com/Blog/Post/?utm=1#x', '/blog/post'],
    ['/blog/post', '/blog/post'],
    ['https://example.com/', '/'],
    ['/caf%C3%A9/', '/café'],
  ])('%s → %s', (a, b) => expect(pathKey(a)).toBe(b))
})

describe('scoreOpportunities', () => {
  it('filters the band, scores matched pages and keeps unmatched ones unscored', () => {
    const res = scoreOpportunities(
      [
        gscRow('/top', 5000, 2), // above the band
        gscRow('/a', 4000, 5),
        gscRow('/b/', 1000, 12),
        gscRow('/c', 3000, 18),
        gscRow('/rare', 10, 8), // below min_impressions
        gscRow('/deep', 900, 35), // below the band
      ],
      [ga4Row('/a', 400, 0.05), ga4Row('/b', 300, 0.1), ga4Row('/other', 50, 0.2)],
      OPTS,
    )
    expect(res.coverage).toEqual({ gsc_pages_total: 6, rows_considered: 3, matched: 2, unmatched: 1, ga4_landing_pages: 3 })
    expect(res.business_value_basis).toBe('key_event_rate')
    const [first, second, third] = res.opportunities
    expect(first.path).toBe('/a')
    expect(first.components!.demand).toBe(1)
    expect(first.components!.reachability).toBeCloseTo((20 - 5) / 16, 3)
    expect(second.path).toBe('/b')
    expect(second.components!.business_value).toBe(1)
    expect(third).toMatchObject({ path: '/c', score: null, ga4: null, unmatched_reason: expect.stringMatching(/No GA4/) })
    // score formula
    const c = first.components!
    expect(first.score).toBe(Math.round(100 * (0.5 * c.demand + 0.3 * c.business_value! + 0.2 * c.reachability)))
    expect(first.potential_clicks).toBe(Math.round(4000 * (0.1 - 5 / 4000)))
  })

  it('falls back to engagement rate when there are no key events, and warns', () => {
    const res = scoreOpportunities([gscRow('/a', 500, 6), gscRow('/b', 500, 6)], [ga4Row('/a', 100, 0, 0.9), ga4Row('/b', 100, 0, 0.3)], OPTS)
    expect(res.business_value_basis).toBe('engagement_rate')
    expect(res.warnings.join(' ')).toMatch(/no key events/)
    expect(res.opportunities[0].path).toBe('/a')
  })

  it('smooths small samples toward the site average', () => {
    const res = scoreOpportunities(
      [gscRow('/tiny', 1000, 8), gscRow('/big', 1000, 8)],
      [ga4Row('/tiny', 1, 1), ga4Row('/big', 300, 0.2)],
      OPTS,
    )
    const by = new Map(res.opportunities.map((o) => [o.path, o]))
    // Raw rates 100% vs 20%; with a 10-session prior the tiny page is pulled toward the mean.
    const mean = (1 * 1 + 0.2 * 300) / 301
    const tiny = (1 * 1 + mean * PRIOR_SESSIONS) / (1 + PRIOR_SESSIONS)
    const big = (0.2 * 300 + mean * PRIOR_SESSIONS) / (300 + PRIOR_SESSIONS)
    // Smoothed: tiny ≈ 0.275, big ≈ 0.200 — a 1-session page keeps only a modest edge (unsmoothed it would be 5×).
    expect(tiny).toBeCloseTo(0.275, 2)
    expect(big).toBeCloseTo(0.2, 2)
    expect(by.get('/tiny')!.components!.business_value).toBe(1)
    expect(by.get('/big')!.components!.business_value).toBeCloseTo(big / tiny, 2)
  })

  it('warns when GA4 has no organic landing pages and when several hosts share paths', () => {
    const res = scoreOpportunities([gscRow('/a', 500, 6), { ...gscRow('/a', 500, 6), page: 'https://blog.example.com/a' }], [], OPTS)
    expect(res.coverage.matched).toBe(0)
    expect(res.warnings.join(' ')).toMatch(/GA4 has no organic landing pages/)
    expect(res.warnings.join(' ')).toMatch(/2 hosts/)
  })
})

describe('helpers', () => {
  it('joinWindow ends at data_through, else three days ago', () => {
    expect(joinWindow(28, '2026-11-15')).toEqual({ start: '2026-10-19', end: '2026-11-15' })
    expect(joinWindow(7, null, new Date('2026-11-18T10:00:00Z'))).toEqual({ start: '2026-11-09', end: '2026-11-15' })
  })
  it('zoneOffsetHours', () => {
    expect(zoneOffsetHours('America/Los_Angeles', 'Etc/GMT-1', new Date('2026-11-18T00:00:00Z'))).toBe(9)
    expect(zoneOffsetHours('UTC', 'UTC')).toBe(0)
  })
  it('latestDate ignores non-dates', () => {
    expect(latestDate(['2026-01-02', 'x', undefined, '2026-01-05'])).toBe('2026-01-05')
    expect(latestDate([])).toBeNull()
  })
})

describe('runPageOpportunities', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('joins GSC and GA4 over the same window ending at data_through', async () => {
    const bodies: { url: string; body: Record<string, unknown> }[] = []
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      bodies.push({ url: u, body })
      if (u.includes('searchAnalytics') && body.dimensions?.[0] === 'date') {
        return new Response(JSON.stringify({ rows: [{ keys: ['2026-11-14'] }, { keys: ['2026-11-15'] }] }))
      }
      if (u.includes('searchAnalytics')) {
        return new Response(JSON.stringify({ rows: [{ keys: ['https://example.com/a'], clicks: 10, impressions: 800, ctr: 0.0125, position: 7 }] }))
      }
      if (u.includes(':runReport')) {
        return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: '/a' }], metricValues: ['50', '30', '0.6', '2', '0.04', '0'].map((value) => ({ value })) }] }))
      }
      return new Response(JSON.stringify({ name: 'properties/123456789', timeZone: 'America/Los_Angeles' }))
    })
    const out = await runPageOpportunities(
      { site: 'sc-domain:example.com', property_id: '123456789', days: 28, min_position: 4, max_position: 20, min_impressions: 50, limit: 50, gsc_row_limit: 5000 },
      new CLIExecutor('/nonexistent/ga4'),
    )
    expect(out).toMatchObject({ success: true, data_through: '2026-11-15', window: { start: '2026-10-19', end: '2026-11-15' }, coverage: { matched: 1 } })
    if (!out.success) return
    expect(out.warnings.some((w) => /Time zones differ/.test(w))).toBe(false)
    const gscQuery = bodies.find((b) => b.url.includes('searchAnalytics') && (b.body.dimensions as string[])[0] === 'page')!
    const ga4Query = bodies.find((b) => b.url.includes(':runReport'))!
    expect(gscQuery.body).toMatchObject({ startDate: '2026-10-19', endDate: '2026-11-15' })
    expect(ga4Query.body.dateRanges).toEqual([{ startDate: '2026-10-19', endDate: '2026-11-15' }])
    expect(JSON.stringify(ga4Query.body.dimensionFilter)).toContain('Organic Search')
  })

  it('requires a property', async () => {
    const out = await runPageOpportunities(
      { site: 'sc-domain:example.com', days: 28, min_position: 4, max_position: 20, min_impressions: 50, limit: 50, gsc_row_limit: 5000 } as never,
      new CLIExecutor('/nonexistent/ga4'),
    )
    expect(out).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })
})
