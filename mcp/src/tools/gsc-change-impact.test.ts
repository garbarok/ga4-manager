import { describe, it, expect, vi, afterEach } from 'vitest'
import { changeWindows, sumMetrics, delta, verdictFor, changesFromAnnotations, runGscChangeImpact, type Thresholds } from './gsc-change-impact.js'
import { CLIExecutor } from '../cli/executor.js'

vi.mock('../utils/google-auth.js', () => ({ getGoogleAuthHeaders: async () => ({ Authorization: 'Bearer t' }) }))

const T: Thresholds = { window_days: 28, min_days: 7, clicks_threshold_pct: 10, position_threshold: 1, min_impressions: 100 }
const row = (clicks: number, impressions: number, position: number) => ({ keys: ['2026-01-01'], clicks, impressions, ctr: clicks / impressions, position })

describe('changeWindows', () => {
  it('builds equal windows around the change day, ending at data_through', () => {
    expect(changeWindows('2026-10-15', '2026-11-15', 28)).toEqual({
      days: 28,
      before: { start: '2026-09-17', end: '2026-10-14' },
      after: { start: '2026-10-16', end: '2026-11-12' },
    })
  })
  it('shrinks both windows to the days available after the change', () => {
    const w = changeWindows('2026-11-05', '2026-11-15', 28)
    expect(w.days).toBe(10)
    expect(w.after).toEqual({ start: '2026-11-06', end: '2026-11-15' })
    expect(w.before).toEqual({ start: '2026-10-26', end: '2026-11-04' })
  })
  it('returns 0 days for a change after data_through', () => {
    expect(changeWindows('2026-11-16', '2026-11-15', 28).days).toBe(0)
  })
})

describe('metrics and verdicts', () => {
  it('weights position by impressions', () => {
    expect(sumMetrics([row(10, 100, 4), row(0, 300, 12)])).toEqual({ clicks: 10, impressions: 400, ctr: 0.025, position: 10 })
    expect(sumMetrics([])).toEqual({ clicks: 0, impressions: 0, ctr: null, position: null })
  })
  it('decides on clicks first, then position, else flat', () => {
    const v = (b: [number, number, number], a: [number, number, number], days = 28) => {
      const before = sumMetrics([row(...b)])
      const after = sumMetrics([row(...a)])
      return verdictFor(days, before, after, delta(before, after), T).verdict
    }
    expect(v([100, 1000, 8], [115, 1000, 8])).toBe('improved')
    expect(v([100, 1000, 8], [85, 1000, 7])).toBe('worse') // clicks win over a better position
    expect(v([100, 1000, 8], [105, 1000, 6.5])).toBe('improved') // clicks flat, position up 1.5
    expect(v([100, 1000, 8], [95, 1000, 9.2])).toBe('worse')
    expect(v([100, 1000, 8], [104, 1000, 8.5])).toBe('flat')
    expect(v([100, 1000, 8], [200, 1000, 8], 5)).toBe('too_early')
    expect(v([1, 30, 8], [5, 40, 8])).toBe('too_early') // 70 impressions < 100
  })
  it('reports CTR change in percentage points and position direction', () => {
    const d = delta(sumMetrics([row(10, 1000, 8)]), sumMetrics([row(30, 1000, 6)]))
    expect(d).toEqual({ clicks: 20, clicks_pct: 200, impressions: 0, impressions_pct: 0, ctr_pp: 2, position: -2 })
  })
})

describe('changesFromAnnotations', () => {
  it('maps user annotations to changes, scoping by URL or path, skipping system ones', () => {
    const out = changesFromAnnotations([
      { name: 'a', title: 'New titles on /blog/', annotationDate: { year: 2026, month: 10, day: 3 } },
      { name: 'b', title: 'Pricing rewrite', description: 'see https://example.com/pricing', annotationDate: { year: 2026, month: 10, day: 9 } },
      { name: 'c', title: 'Site redesign', annotationDateRange: { startDate: { year: 2026, month: 9, day: 1 }, endDate: { year: 2026, month: 9, day: 3 } } },
      { name: 'd', title: 'Google update', systemGenerated: true, annotationDate: { year: 2026, month: 9, day: 5 } },
    ])
    expect(out).toEqual([
      { changed_on: '2026-10-03', label: 'New titles on /blog/', prefix: '/blog/' },
      { changed_on: '2026-10-09', label: 'Pricing rewrite', prefix: 'https://example.com/pricing' },
      { changed_on: '2026-09-01', label: 'Site redesign' },
    ])
  })
})

describe('runGscChangeImpact', () => {
  afterEach(() => vi.restoreAllMocks())

  it('queries both windows with the scope filter and returns a verdict per change', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      if (!body.dimensionFilterGroups && body.rowLimit === 30) return new Response(JSON.stringify({ rows: [{ keys: ['2026-11-15'] }] }))
      const after = body.startDate > '2026-10-15'
      return new Response(JSON.stringify({ rows: [after ? row(150, 2000, 7) : row(100, 2000, 8)] }))
    })
    const out = await runGscChangeImpact(
      {
        site: 'sc-domain:example.com',
        changes: [
          { prefix: '/blog/', changed_on: '2026-10-15', label: 'blog titles' },
          { changed_on: '2026-11-12', label: 'too recent' },
        ],
        from_annotations: false,
        window_days: 28,
        min_days: 7,
        clicks_threshold_pct: 10,
        position_threshold: 1,
        min_impressions: 100,
      },
      new CLIExecutor('/nonexistent/ga4'),
    )
    expect(out).toMatchObject({ success: true, data_through: '2026-11-15', quota_used: 3 })
    if (!out.success) return
    expect(out.changes[0]).toMatchObject({ verdict: 'improved', days_per_window: 28, scope: { type: 'prefix', value: '/blog/' } })
    expect(out.changes[1]).toMatchObject({ verdict: 'too_early', days_per_window: 3, before: null })
    const filtered = bodies.find((b) => b.dimensionFilterGroups)!
    expect(JSON.stringify(filtered.dimensionFilterGroups)).toContain('^https?://[^/]+/blog/')
    expect(out.thresholds).toMatchObject({ clicks_threshold_pct: 10, position_threshold: 1 })
  })

  it('needs changes or from_annotations', async () => {
    const { gscChangeImpactInputSchema } = await import('./gsc-change-impact.js')
    expect(gscChangeImpactInputSchema.safeParse({ site: 'sc-domain:example.com' }).success).toBe(false)
  })
})
