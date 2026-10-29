import { describe, it, expect } from 'vitest'
import {
  EMPTY_KPIS,
  MAX_FINDINGS,
  digestFindings,
  hygieneFinding,
  joinTopPages,
  kpiDeltas,
  normalizePagePath,
  opportunityFinding,
  type Finding,
} from './compute-growth-brief.js'

describe('normalizePagePath', () => {
  it.each([
    ['https://www.x.app/blog/post#section', '/blog/post'],
    ['https://www.x.app/blog/post/', '/blog/post'],
    ['https://www.x.app/Calc?ref=nav', '/calc'],
    ['https://www.x.app', '/'],
    ['https://www.x.app/', '/'],
    ['/calculator/mortgage-calculator', '/calculator/mortgage-calculator'],
    ['/', '/'],
  ])('%s → %s', (input, want) => {
    expect(normalizePagePath(input)).toBe(want)
  })
})

describe('joinTopPages', () => {
  it('collapses GSC fragment variants into the GA4 path', () => {
    const pages = joinTopPages(
      [
        { page: 'https://www.x.app/blog/post', clicks: 26, impressions: 4008 },
        { page: 'https://www.x.app/blog/post#section', clicks: 0, impressions: 10 },
      ],
      [{ pagePath: '/blog/post', sessions: 74, ad_revenue: 0.1944 }],
    )
    expect(pages).toEqual([
      { path: '/blog/post', gsc_clicks: 26, gsc_impressions: 4018, sessions: 74, ad_revenue: 0.1944 },
    ])
  })

  it('keeps one-source pages with nulls and ranks by revenue, then clicks', () => {
    const pages = joinTopPages(
      [
        { page: 'https://www.x.app/calculator/mortgage-calculator', clicks: 500, impressions: 100000 },
        { page: 'https://www.x.app/only-in-gsc', clicks: 5000, impressions: 9000 },
      ],
      [
        { pagePath: '/calculator/mortgage-calculator', sessions: 2000, ad_revenue: 4.54 },
        { pagePath: '/only-in-ga4', sessions: 10, ad_revenue: 0.01 },
      ],
    )
    expect(pages.map((p) => p.path)).toEqual(['/calculator/mortgage-calculator', '/only-in-ga4', '/only-in-gsc'])
    expect(pages[1]).toMatchObject({ gsc_clicks: null, gsc_impressions: null, sessions: 10 })
    expect(pages[2]).toMatchObject({ sessions: null, ad_revenue: null, gsc_clicks: 5000 })
  })

  it('caps at the limit', () => {
    const gsc = Array.from({ length: 15 }, (_, i) => ({ page: `https://x.app/p${i}`, clicks: i, impressions: i }))
    expect(joinTopPages(gsc, [], 10)).toHaveLength(10)
  })
})

describe('kpiDeltas', () => {
  it('computes percentage change and nulls when a side is missing or zero', () => {
    const d = kpiDeltas(
      { ...EMPTY_KPIS, gsc_clicks: 250, sessions: 100, ad_revenue: 1 },
      { ...EMPTY_KPIS, gsc_clicks: 200, sessions: 0, ad_revenue: null },
    )
    expect(d.gsc_clicks).toBe(25)
    expect(d.sessions).toBeNull()
    expect(d.ad_revenue).toBeNull()
    expect(d.gsc_position).toBeNull()
  })
})

describe('digestFindings', () => {
  it('orders by impact desc with null impact last, capped', () => {
    const big = opportunityFinding({
      page: 'https://www.x.app/calculator/mortgage-calculator',
      position: 8.7,
      ctr: 0.005,
      category_median_ctr: 0.035,
      potential_clicks: 5000,
      anonymized_share: 0.8,
    })
    const small = opportunityFinding({ page: '/b', position: 7, ctr: 0.01, category_median_ctr: 0.045, potential_clicks: 12 })
    const hygiene = hygieneFinding({ url: 'https://www.x.app/a#x', issue: 'fragment', severity: 'warning' })

    const out = digestFindings([hygiene, small, big])
    expect(out.map((f) => f.impact)).toEqual([5000, 12, null])
    expect(out[0].summary).toContain('long-tail')
  })

  it('caps at MAX_FINDINGS', () => {
    const many: Finding[] = Array.from({ length: 25 }, (_, i) => ({
      source: 'opportunities',
      summary: 's',
      page: `/p${i}`,
      impact: i,
    }))
    const out = digestFindings(many)
    expect(out).toHaveLength(MAX_FINDINGS)
    expect(out[0].impact).toBe(24)
  })
})
