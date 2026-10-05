import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { valueSerpSearch } from './valueserp-client.js'
import { ErrorCode } from './errors.js'

describe('valueSerpSearch', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.VALUESERP_API_KEY
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  it('throws AUTH_DENIED when no api key is available', async () => {
    await expect(valueSerpSearch({ q: 'test' })).rejects.toMatchObject({ code: ErrorCode.AUTH_DENIED })
  })

  it('builds the query string with defaults and returns organic results', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          request_info: { success: true },
          organic_results: [{ position: 1, title: 'Example', link: 'https://example.com/' }],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await valueSerpSearch({ q: 'test query', api_key: 'key-1' })

    expect(result.organic).toEqual([{ position: 1, title: 'Example', link: 'https://example.com/' }])
    expect(result.aiOverviewPresent).toBe(false)
    expect(result.aiOverviewSources).toEqual([])
    const [url] = mockFetch.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://api.valueserp.com/search')
    expect(parsed.searchParams.get('q')).toBe('test query')
    expect(parsed.searchParams.get('location')).toBe('United States')
    expect(parsed.searchParams.get('google_domain')).toBe('google.com')
    expect(parsed.searchParams.get('num')).toBe('100')
    expect(parsed.searchParams.get('api_key')).toBe('key-1')
    expect(parsed.searchParams.has('include_ai_overview')).toBe(false)
  })

  it('falls back to the VALUESERP_API_KEY env var', async () => {
    process.env.VALUESERP_API_KEY = 'env-key'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ organic_results: [] }) }),
    )

    await valueSerpSearch({ q: 'x' })
    // no throw means the env var was picked up
  })

  it('detects an AI Overview from the free message hint without fetching sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            organic_results: [],
            ai_overview: { message: 'Google offers an AI Overview for this search.' },
          }),
      }),
    )

    const result = await valueSerpSearch({ q: 'x', api_key: 'k' })
    expect(result.aiOverviewPresent).toBe(true)
    expect(result.aiOverviewSources).toEqual([])
  })

  it('parses AI Overview sources and sets include_ai_overview when requested', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          organic_results: [],
          ai_overview: {
            ai_overview_sources: [
              { source_url: 'https://example.com/page', source_domain: 'example.com', source_title: 'Example' },
            ],
          },
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await valueSerpSearch({ q: 'x', api_key: 'k', include_ai_overview: true })

    expect(result.aiOverviewPresent).toBe(true)
    expect(result.aiOverviewSources).toEqual([
      { url: 'https://example.com/page', domain: 'example.com', title: 'Example' },
    ])
    const [url] = mockFetch.mock.calls[0]
    expect(new URL(url).searchParams.get('include_ai_overview')).toBe('true')
  })

  it('maps a non-ok HTTP response to a ToolError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad key') }))

    await expect(valueSerpSearch({ q: 'x', api_key: 'k' })).rejects.toMatchObject({ code: ErrorCode.AUTH_DENIED })
  })

  it('throws INVALID_INPUT when request_info reports failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ request_info: { success: false, message: 'bad query' } }),
      }),
    )

    await expect(valueSerpSearch({ q: 'x', api_key: 'k' })).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT })
  })

  it('retries once after a timeout and returns the second response', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ organic_results: [] }) })
    vi.stubGlobal('fetch', mockFetch)

    const result = await valueSerpSearch({ q: 'x', api_key: 'k' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.organic).toEqual([])
  })

  it('retries once on a 5xx, then reports the error', async () => {
    const failing = { ok: false, status: 503, text: () => Promise.resolve('busy') }
    const mockFetch = vi.fn().mockResolvedValue(failing)
    vi.stubGlobal('fetch', mockFetch)

    await expect(valueSerpSearch({ q: 'x', api_key: 'k' })).rejects.toMatchObject({ code: ErrorCode.UPSTREAM_5XX })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry auth errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad key') })
    vi.stubGlobal('fetch', mockFetch)

    await expect(valueSerpSearch({ q: 'x', api_key: 'k' })).rejects.toBeDefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('gives up after the second timeout', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    const mockFetch = vi.fn().mockRejectedValue(timeout)
    vi.stubGlobal('fetch', mockFetch)

    await expect(valueSerpSearch({ q: 'x', api_key: 'k' })).rejects.toThrow('timeout')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
