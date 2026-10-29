import { describe, it, expect } from 'vitest'
import { estimatePixelWidth } from './pixel-width.js'

describe('estimatePixelWidth', () => {
  it('returns 0 for empty string', () => {
    expect(estimatePixelWidth('')).toBe(0)
  })

  it('measures single known char: uppercase W = 11', () => {
    expect(estimatePixelWidth('W')).toBe(11)
  })

  it('measures single known char: lowercase i = 3', () => {
    expect(estimatePixelWidth('i')).toBe(3)
  })

  it('golden value: "Hello World"', () => {
    // H=9 e=7 l=3 l=3 o=7 ' '=3 W=11 o=7 r=4 l=3 d=7 = 64
    expect(estimatePixelWidth('Hello World')).toBe(64)
  })

  it('golden value: "abc" = 20', () => {
    // a=7 b=7 c=6 = 20
    expect(estimatePixelWidth('abc')).toBe(20)
  })

  it('golden value: "123" = 21', () => {
    // 1=7 2=7 3=7 = 21
    expect(estimatePixelWidth('123')).toBe(21)
  })

  it('uses default 8px for unmapped chars (emoji)', () => {
    // Single emoji = 8px default
    expect(estimatePixelWidth('🎉')).toBe(8)
  })

  it('uses default 8px for multi-byte / CJK chars', () => {
    // CJK char = 8px default
    expect(estimatePixelWidth('中')).toBe(8)
  })

  it('accumulates width across mixed mapped and unmapped chars', () => {
    // 'A' = 9, '🎉' = 8 (default) → 17
    expect(estimatePixelWidth('A🎉')).toBe(17)
  })

  it('sums all chars in a realistic title', () => {
    // "SEO" = S=7+E=7+O=9 = 23; verify non-zero
    const width = estimatePixelWidth('SEO Best Practices for 2024')
    expect(width).toBeGreaterThan(0)
    expect(typeof width).toBe('number')
  })
})
