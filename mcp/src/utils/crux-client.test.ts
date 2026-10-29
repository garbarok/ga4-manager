import { describe, it, expect, vi, afterEach } from 'vitest'
import { categorize, fetchCruxFieldData, fetchCruxHistory } from './crux-client.js'
import { ErrorCode } from './errors.js'

const URL_RECORD = {
  record: {
    key: { url: 'https://example.com/page', formFactor: 'PHONE' },
    metrics: {
      largest_contentful_paint: { percentiles: { p75: 2300 } },
      interaction_to_next_paint: { percentiles: { p75: 350 } },
      cumulative_layout_shift: { percentiles: { p75: '0.31' } },
    },
    collectionPeriod: {
      firstDate: { year: 2026, month: 9, day: 28 },
      lastDate: { year: 2026, month: 10, day: 25 },
    },
  },
}

const HISTORY_RECORD = {
  record: {
    metrics: {
      largest_contentful_paint: { percentilesTimeseries: { p75s: [2400, null, 2600] } },
      interaction_to_next_paint: { percentilesTimeseries: { p75s: [180, 190, 210] } },
      cumulative_layout_shift: { percentilesTimeseries: { p75s: ['0.05', 'NaN', '0.12'] } },
    },
    collectionPeriods: [
      { firstDate: { year: 2026, month: 9, day: 28 }, lastDate: { year: 2026, month: 10, day: 11 } },
      { firstDate: { year: 2026, month: 10, day: 5 }, lastDate: { year: 2026, month: 10, day: 18 } },
      { firstDate: { year: 2026, month: 10, day: 12 }, lastDate: { year: 2026, month: 10, day: 25 } },
    ],
  },
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
const notFound = () => ({
  ok: false,
  status: 404,
  text: () => Promise.resolve('{"error":{"code":404,"status":"NOT_FOUND"}}'),
})

describe('categorize', () => {
  it('applies the Google thresholds at the boundaries', () => {
    expect(categorize('lcp', 2500)).toBe('good')
    expect(categorize('lcp', 2501)).toBe('needs-improvement')
    expect(categorize('lcp', 4000)).toBe('needs-improvement')
    expect(categorize('lcp', 4001)).toBe('poor')
    expect(categorize('inp', 200)).toBe('good')
    expect(categorize('inp', 500)).toBe('needs-improvement')
    expect(categorize('inp', 501)).toBe('poor')
    expect(categorize('cls', 0.1)).toBe('good')
    expect(categorize('cls', 0.25)).toBe('needs-improvement')
    expect(categorize('cls', 0.26)).toBe('poor')
  })
})

describe('fetchCruxFieldData', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns URL-level p75 with categories and the collection period', async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok(URL_RECORD))
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchCruxFieldData('https://example.com/page', 'PHONE', 'KEY')

    expect(result).toEqual({
      scope: 'url',
      form_factor: 'PHONE',
      collection_period: { first: '2026-09-28', last: '2026-10-25' },
      metrics: {
        lcp: { p75: 2300, category: 'good' },
        inp: { p75: 350, category: 'needs-improvement' },
        cls: { p75: 0.31, category: 'poor' },
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=KEY')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ url: 'https://example.com/page', formFactor: 'PHONE' })
  })

  it('falls back to the origin when the URL has no record', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(notFound()).mockResolvedValueOnce(ok(URL_RECORD))
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchCruxFieldData('https://example.com/page?x=1', 'DESKTOP', 'KEY')

    expect(result?.scope).toBe('origin')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
      origin: 'https://example.com',
      formFactor: 'DESKTOP',
    })
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).url).toBeUndefined()
  })

  it('returns null when neither the URL nor the origin has a record', async () => {
    const mockFetch = vi.fn().mockResolvedValue(notFound())
    vi.stubGlobal('fetch', mockFetch)

    expect(await fetchCruxFieldData('https://example.com/page', 'PHONE', 'KEY')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws a classified ToolError on non-404 failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('API key not valid') }),
    )

    await expect(fetchCruxFieldData('https://example.com/', 'PHONE', 'BAD')).rejects.toMatchObject({
      code: ErrorCode.AUTH_DENIED,
    })
  })
})

describe('fetchCruxHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns aligned weekly p75 series and sends collectionPeriodCount', async () => {
    const mockFetch = vi.fn().mockResolvedValue(ok(HISTORY_RECORD))
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchCruxHistory('https://example.com/page', 'PHONE', 'KEY', 3)

    expect(result).toEqual({
      scope: 'url',
      form_factor: 'PHONE',
      periods: ['2026-10-11', '2026-10-18', '2026-10-25'],
      series: {
        lcp: [2400, null, 2600],
        inp: [180, 190, 210],
        cls: [0.05, null, 0.12],
      },
    })
    const [calledUrl, init] = mockFetch.mock.calls[0]
    expect(calledUrl).toBe('https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=KEY')
    expect(JSON.parse(init.body)).toMatchObject({ collectionPeriodCount: 3, formFactor: 'PHONE' })
  })

  it('returns null when neither URL nor origin has history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound()))
    expect(await fetchCruxHistory('https://example.com/page', 'PHONE', 'KEY', 10)).toBeNull()
  })
})
