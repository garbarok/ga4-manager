import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ErrorCode } from '../utils/errors.js'
import { indexnowSubmitInputSchema, runIndexnowSubmit } from './indexnow-submit.js'

const KEY = 'abcd1234efgh'
const URLS = ['https://example.com/a', 'https://example.com/b']

function res(status: number, body = '') {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) }
}

/** Key-file GET answers with the key; the POST answers with `postStatus`. */
function mockFetch(postStatus = 200, keyBody = KEY, keyStatus = 200) {
  return vi
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? res(postStatus) : res(keyStatus, keyBody)),
    )
}

const parse = (o: object) => indexnowSubmitInputSchema.parse(o)

describe('runIndexnowSubmit', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.INDEXNOW_KEY
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  it('defaults to dry run: verifies the key file, returns the payload, never POSTs', async () => {
    const f = mockFetch()
    vi.stubGlobal('fetch', f)

    const result = await runIndexnowSubmit(parse({ urls: URLS, key: KEY }))

    expect(result).toEqual({
      success: true,
      dry_run: true,
      endpoint: 'https://api.indexnow.org/indexnow',
      key_file_verified: true,
      would_send: { host: 'example.com', key: KEY, urlList: URLS },
    })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe(`https://example.com/${KEY}.txt`)
  })

  it('POSTs the JSON payload with the right content type on a real submit', async () => {
    const f = mockFetch(200)
    vi.stubGlobal('fetch', f)

    const result = await runIndexnowSubmit(
      parse({ urls: URLS, key: KEY, key_location: `https://example.com/keys/${KEY}.txt`, dry_run: false }),
    )

    expect(result).toMatchObject({ success: true, dry_run: false, status: 200, outcome: 'accepted', submitted: 2 })
    const [url, init] = f.mock.calls[1]
    expect(url).toBe('https://api.indexnow.org/indexnow')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(init.body)).toEqual({
      host: 'example.com',
      key: KEY,
      keyLocation: `https://example.com/keys/${KEY}.txt`,
      urlList: URLS,
    })
  })

  it('treats 202 as accepted with key validation pending', async () => {
    vi.stubGlobal('fetch', mockFetch(202))
    const result = await runIndexnowSubmit(parse({ urls: URLS, key: KEY, dry_run: false }))
    expect(result).toMatchObject({ success: true, status: 202, outcome: 'accepted_key_pending' })
  })

  it.each([
    [400, ErrorCode.INVALID_INPUT],
    [403, ErrorCode.AUTH_DENIED],
    [422, ErrorCode.INVALID_INPUT],
    [429, ErrorCode.QUOTA_EXCEEDED],
    [503, ErrorCode.UPSTREAM_5XX],
  ])('maps HTTP %i to %s', async (status, code) => {
    vi.stubGlobal('fetch', mockFetch(status))
    const result = await runIndexnowSubmit(parse({ urls: URLS, key: KEY, dry_run: false }))
    expect(result).toMatchObject({ success: false, error: { code } })
  })

  it('falls back to INDEXNOW_KEY and ignores an empty value', async () => {
    process.env.INDEXNOW_KEY = KEY
    vi.stubGlobal('fetch', mockFetch())
    const ok = await runIndexnowSubmit(parse({ urls: URLS }))
    expect(ok).toMatchObject({ success: true, would_send: { key: KEY } })

    process.env.INDEXNOW_KEY = ''
    const missing = await runIndexnowSubmit(parse({ urls: URLS }))
    expect(missing).toMatchObject({ success: false, error: { code: ErrorCode.INVALID_INPUT } })
  })

  it('rejects URLs on different hosts without fetching', async () => {
    const f = mockFetch()
    vi.stubGlobal('fetch', f)
    const result = await runIndexnowSubmit(parse({ urls: ['https://example.com/a', 'https://other.com/b'], key: KEY }))
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.INVALID_INPUT } })
    expect(f).not.toHaveBeenCalled()
  })

  it.each(['short', 'has space in it', 'bad_chars_here!', 'a'.repeat(129)])('rejects invalid key %j', async (key) => {
    vi.stubGlobal('fetch', mockFetch())
    const result = await runIndexnowSubmit(parse({ urls: URLS, key }))
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.INVALID_INPUT } })
  })

  it('fails with a hint when the key file does not contain the key', async () => {
    const f = mockFetch(200, 'something-else')
    vi.stubGlobal('fetch', f)
    const result = await runIndexnowSubmit(parse({ urls: URLS, key: KEY, dry_run: false }))
    expect(result).toMatchObject({
      success: false,
      error: { code: ErrorCode.INVALID_INPUT, hint: expect.stringContaining(`${KEY}.txt`) },
    })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('fails when the key file is missing or unreachable', async () => {
    vi.stubGlobal('fetch', mockFetch(200, '', 404))
    expect(await runIndexnowSubmit(parse({ urls: URLS, key: KEY }))).toMatchObject({ success: false })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))
    expect(await runIndexnowSubmit(parse({ urls: URLS, key: KEY }))).toMatchObject({ success: false })
  })

  it('rejects a key_location on another host', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const result = await runIndexnowSubmit(parse({ urls: URLS, key: KEY, key_location: `https://cdn.other.com/${KEY}.txt` }))
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.INVALID_INPUT } })
  })

  it('schema bounds the URL count', () => {
    expect(indexnowSubmitInputSchema.safeParse({ urls: [] }).success).toBe(false)
    expect(indexnowSubmitInputSchema.safeParse({ urls: Array(10001).fill('https://example.com/x') }).success).toBe(false)
  })
})
