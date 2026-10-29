import { describe, it, expect } from 'vitest'
import { computeTrafficDiff, type GscRow } from './compute-traffic-diff.js'

function row(
  url: string,
  clicks: number,
  impressions = 1000,
  ctr = 0.05,
  position = 5.0,
): GscRow {
  return { keys: [url], clicks, impressions, ctr, position }
}

describe('computeTrafficDiff', () => {
  // ── Basic classification ────────────────────────────────────────────────

  it('classifies >5% click drop as a drop', () => {
    const { drops, gains } = computeTrafficDiff(
      [row('/a', 100)],
      [row('/a', 80)], // -20%
    )
    expect(drops).toHaveLength(1)
    expect(drops[0].url).toBe('/a')
    expect(drops[0].clicks_delta).toBe(-20)
    expect(gains).toHaveLength(0)
  })

  it('classifies >5% click gain as a gain', () => {
    const { drops, gains } = computeTrafficDiff(
      [row('/b', 100)],
      [row('/b', 130)], // +30%
    )
    expect(gains).toHaveLength(1)
    expect(gains[0].url).toBe('/b')
    expect(gains[0].clicks_delta).toBe(30)
    expect(drops).toHaveLength(0)
  })

  it('counts ±5% as unchanged', () => {
    const { drops, gains, unchanged } = computeTrafficDiff(
      [row('/c', 100)],
      [row('/c', 103)], // +3%
    )
    expect(unchanged).toBe(1)
    expect(drops).toHaveLength(0)
    expect(gains).toHaveLength(0)
  })

  // ── Only-in-A / only-in-B ──────────────────────────────────────────────

  it('counts URLs only in A and only in B', () => {
    const { summary } = computeTrafficDiff(
      [row('/only-a', 50), row('/common', 100)],
      [row('/only-b', 50), row('/common', 90)],
    )
    expect(summary.urls_only_in_a).toBe(1)
    expect(summary.urls_only_in_b).toBe(1)
    expect(summary.urls_compared).toBe(1)
  })

  // ── Delta fields ───────────────────────────────────────────────────────

  it('computes all delta fields', () => {
    const { drops } = computeTrafficDiff(
      [row('/p', 200, 4000, 0.05, 3.0)],
      [row('/p', 100, 2000, 0.03, 5.0)], // -50%, -2000 imp, -0.02 ctr, +2 pos
    )
    expect(drops[0].clicks_delta).toBe(-100)
    expect(drops[0].clicks_pct).toBe(-50)
    expect(drops[0].impressions_delta).toBe(-2000)
    expect(drops[0].ctr_delta).toBeCloseTo(-0.02, 4)
    expect(drops[0].position_delta).toBe(2)
  })

  it('includes ctr_delta and position_delta in output', () => {
    const { drops } = computeTrafficDiff(
      [row('/p', 100, 1000, 0.1, 2.0)],
      [row('/p', 50, 800, 0.0625, 3.5)],
    )
    expect(drops[0]).toHaveProperty('ctr_delta')
    expect(drops[0]).toHaveProperty('position_delta')
    expect(drops[0].position_delta).toBeCloseTo(1.5, 1)
  })

  // ── Filtering ──────────────────────────────────────────────────────────

  it('min_clicks_a excludes URLs below threshold', () => {
    const { drops } = computeTrafficDiff(
      [row('/low', 3), row('/high', 200)],
      [row('/low', 1), row('/high', 150)],
      { min_clicks_a: 10 },
    )
    expect(drops.every((d) => d.url !== '/low')).toBe(true)
    expect(drops.some((d) => d.url === '/high')).toBe(true)
  })

  // ── Sort order ─────────────────────────────────────────────────────────

  it('sorts drops by clicks_abs worst first (default)', () => {
    const { drops } = computeTrafficDiff(
      [row('/big', 1000), row('/small', 100)],
      [row('/big', 500), row('/small', 80)],
    )
    expect(drops[0].url).toBe('/big')
  })

  it('sorts drops by clicks_pct when sort_by=clicks_pct', () => {
    // /pct: 100→10 = -90%; /abs: 1000→500 = -50%
    const { drops } = computeTrafficDiff(
      [row('/pct', 100), row('/abs', 1000)],
      [row('/pct', 10), row('/abs', 500)],
      { sort_by: 'clicks_pct' },
    )
    expect(drops[0].url).toBe('/pct')
  })

  it('sorts drops by impressions_abs when sort_by=impressions_abs', () => {
    const { drops } = computeTrafficDiff(
      [row('/big-imp', 100, 5000), row('/small-imp', 100, 500)],
      [row('/big-imp', 80, 1000), row('/small-imp', 80, 400)],
      { sort_by: 'impressions_abs' },
    )
    expect(drops[0].url).toBe('/big-imp')
  })

  // ── Top-N truncation ───────────────────────────────────────────────────

  it('truncates drops and gains to output_limit', () => {
    const rowsA = Array.from({ length: 60 }, (_, i) => row(`/page-${i}`, 100))
    const rowsB = Array.from({ length: 60 }, (_, i) => row(`/page-${i}`, 50))
    const { drops } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(drops).toHaveLength(50)
  })

  it('default output_limit is 50', () => {
    const rowsA = Array.from({ length: 60 }, (_, i) => row(`/p-${i}`, 100))
    const rowsB = Array.from({ length: 60 }, (_, i) => row(`/p-${i}`, 50))
    const { drops } = computeTrafficDiff(rowsA, rowsB)
    expect(drops).toHaveLength(50)
  })

  // ── Tail summaries ─────────────────────────────────────────────────────

  it('drops_tail count = total drops minus output_limit', () => {
    const rowsA = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 100))
    const rowsB = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 50))
    const { drops_tail } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(drops_tail.count).toBe(20)
  })

  it('drops_tail total_clicks_delta sums the tail rows', () => {
    // 70 drops each -50 clicks; top 50 captured, tail 20 each -50 = -1000
    const rowsA = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 100))
    const rowsB = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 50))
    const { drops_tail } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(drops_tail.total_clicks_delta).toBe(-1000)
  })

  it('drops_tail sample has at most 5 rows', () => {
    const rowsA = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 100))
    const rowsB = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 50))
    const { drops_tail } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(drops_tail.sample.length).toBeLessThanOrEqual(5)
    expect(drops_tail.sample).toHaveLength(5)
  })

  it('gains_tail count = total gains minus output_limit', () => {
    const rowsA = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 50))
    const rowsB = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 100))
    const { gains_tail } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(gains_tail.count).toBe(20)
  })

  it('gains_tail total_clicks_delta sums the tail rows', () => {
    // 70 gains each +50 clicks; top 50 captured, tail 20 each +50 = +1000
    const rowsA = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 50))
    const rowsB = Array.from({ length: 70 }, (_, i) => row(`/page-${i}`, 100))
    const { gains_tail } = computeTrafficDiff(rowsA, rowsB, { output_limit: 50 })
    expect(gains_tail.total_clicks_delta).toBe(1000)
  })

  it('tail is empty when drops/gains count <= output_limit', () => {
    const { drops_tail, gains_tail } = computeTrafficDiff(
      [row('/a', 100)],
      [row('/a', 50)],
      { output_limit: 50 },
    )
    expect(drops_tail).toEqual({ count: 0, total_clicks_delta: 0, sample: [] })
    expect(gains_tail).toEqual({ count: 0, total_clicks_delta: 0, sample: [] })
  })

  it('integration: 1000-row fixture — drops/gains bounded by output_limit', () => {
    const rowsA = Array.from({ length: 1000 }, (_, i) => row(`/page-${i}`, 100 + i))
    // Even pages: -50% drop; odd pages: +50% gain
    const rowsB = Array.from({ length: 1000 }, (_, i) =>
      row(`/page-${i}`, i % 2 === 0 ? Math.round((100 + i) * 0.5) : Math.round((100 + i) * 1.5)),
    )
    const limit = 30
    const { drops, gains, drops_tail, gains_tail } = computeTrafficDiff(rowsA, rowsB, {
      output_limit: limit,
    })
    expect(drops.length).toBeLessThanOrEqual(limit)
    expect(gains.length).toBeLessThanOrEqual(limit)
    // Tail must account for the rest
    expect(drops.length + drops_tail.count).toBe(500) // 500 even pages = drops
    expect(gains.length + gains_tail.count).toBe(500) // 500 odd pages = gains
  })

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('handles empty input', () => {
    const { drops, gains, unchanged, summary } = computeTrafficDiff([], [])
    expect(drops).toHaveLength(0)
    expect(gains).toHaveLength(0)
    expect(unchanged).toBe(0)
    expect(summary.urls_compared).toBe(0)
  })

  it('handles zero clicks in period A (clicks_pct = 0 → unchanged)', () => {
    const { unchanged } = computeTrafficDiff(
      [row('/zero', 0)],
      [row('/zero', 10)],
    )
    expect(unchanged).toBe(1)
  })

  it('computes clicks_pct correctly for -50%', () => {
    const { drops } = computeTrafficDiff(
      [row('/p', 200)],
      [row('/p', 100)],
    )
    expect(drops[0].clicks_pct).toBe(-50)
  })

  it('computes impressions_delta correctly', () => {
    const { drops } = computeTrafficDiff(
      [row('/p', 100, 2000)],
      [row('/p', 80, 1500)],
    )
    expect(drops[0].impressions_delta).toBe(-500)
  })

  it('URLs not present in both periods are excluded from diff', () => {
    const { summary, drops, gains, unchanged } = computeTrafficDiff(
      [row('/only-a', 100)],
      [row('/only-b', 100)],
    )
    expect(drops).toHaveLength(0)
    expect(gains).toHaveLength(0)
    expect(unchanged).toBe(0)
    expect(summary.urls_compared).toBe(0)
    expect(summary.urls_only_in_a).toBe(1)
    expect(summary.urls_only_in_b).toBe(1)
  })

  // ── normalize_mode_used ────────────────────────────────────────────────

  it('includes normalize_mode_used in result (default: minimal)', () => {
    const result = computeTrafficDiff([], [])
    expect(result.normalize_mode_used).toBe('minimal')
  })

  it('includes normalize_mode_used when explicitly set', () => {
    const result = computeTrafficDiff([], [], { normalize: 'aggressive' })
    expect(result.normalize_mode_used).toBe('aggressive')
  })

  it('includes normalize_mode_used: none when none passed', () => {
    const result = computeTrafficDiff([], [], { normalize: 'none' })
    expect(result.normalize_mode_used).toBe('none')
  })

  // ── URL normalization — integration ───────────────────────────────────

  function fullRow(
    url: string,
    clicks: number,
    impressions = 1000,
    ctr = 0.05,
    position = 5.0,
  ): GscRow {
    return { keys: [url], clicks, impressions, ctr, position }
  }

  it('minimal: trailing-slash variant inner-joins with non-trailing-slash variant', () => {
    // period_a has trailing slash; period_b does not → should still match
    const { drops, summary } = computeTrafficDiff(
      [fullRow('https://example.com/blog/', 100)],
      [fullRow('https://example.com/blog', 70)],
      { normalize: 'minimal' },
    )
    expect(summary.urls_compared).toBe(1)
    expect(drops[0].clicks_delta).toBe(-30)
  })

  it('minimal: different host casing inner-joins', () => {
    const { summary } = computeTrafficDiff(
      [fullRow('https://EXAMPLE.COM/page', 100)],
      [fullRow('https://example.com/page', 80)],
      { normalize: 'minimal' },
    )
    expect(summary.urls_compared).toBe(1)
  })

  it('aggressive: www vs apex inner-joins', () => {
    const { summary } = computeTrafficDiff(
      [fullRow('https://www.example.com/page', 100)],
      [fullRow('https://example.com/page', 80)],
      { normalize: 'aggressive' },
    )
    expect(summary.urls_compared).toBe(1)
  })

  it('aggressive: http vs https inner-joins', () => {
    const { summary } = computeTrafficDiff(
      [fullRow('http://example.com/page', 100)],
      [fullRow('https://example.com/page', 80)],
      { normalize: 'aggressive' },
    )
    expect(summary.urls_compared).toBe(1)
  })

  it('aggressive: query string variants inner-join', () => {
    const { summary } = computeTrafficDiff(
      [fullRow('https://example.com/page?utm_source=google', 100)],
      [fullRow('https://example.com/page', 80)],
      { normalize: 'aggressive' },
    )
    expect(summary.urls_compared).toBe(1)
  })

  it('none: trailing-slash variants do NOT inner-join', () => {
    const { summary } = computeTrafficDiff(
      [fullRow('https://example.com/blog/', 100)],
      [fullRow('https://example.com/blog', 70)],
      { normalize: 'none' },
    )
    expect(summary.urls_compared).toBe(0)
    expect(summary.urls_only_in_a).toBe(1)
    expect(summary.urls_only_in_b).toBe(1)
  })
})
