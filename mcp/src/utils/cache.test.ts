import { describe, it, expect, vi, afterEach } from 'vitest'
import { TTLCache } from './cache.js'

describe('TTLCache', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined on cache miss', () => {
    const cache = new TTLCache<string>(1000)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('returns value on cache hit', () => {
    const cache = new TTLCache<string>(1000)
    cache.set('key', 'value')
    expect(cache.get('key')).toBe('value')
  })

  it('returns undefined after TTL expires (lazy expiry)', () => {
    vi.useFakeTimers()
    const cache = new TTLCache<string>(500)
    cache.set('key', 'value')

    vi.advanceTimersByTime(499)
    expect(cache.get('key')).toBe('value')

    vi.advanceTimersByTime(1)
    expect(cache.get('key')).toBeUndefined()
  })

  it('removes expired entry on lazy access (no background timer)', () => {
    vi.useFakeTimers()
    const cache = new TTLCache<number>(100)
    cache.set('a', 1)
    cache.set('b', 2)

    vi.advanceTimersByTime(101)
    // Accessing 'a' should delete it; 'b' still physically in map but expired
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('overwrites existing entry and resets TTL', () => {
    vi.useFakeTimers()
    const cache = new TTLCache<string>(500)
    cache.set('key', 'first')
    vi.advanceTimersByTime(400)
    cache.set('key', 'second')
    vi.advanceTimersByTime(400) // 800ms total, but second set was at 400ms → still valid
    expect(cache.get('key')).toBe('second')
  })

  it('stores null values (used as sentinel for "no robots.txt")', () => {
    const cache = new TTLCache<string | null>(1000)
    cache.set('origin', null)
    expect(cache.get('origin')).toBeNull()
  })
})
