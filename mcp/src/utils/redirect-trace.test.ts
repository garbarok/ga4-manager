import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWithTrace } from './redirect-trace.js'
import { ToolError, ErrorCode } from './errors.js'

function makeRedirectResponse(status: number, location: string) {
  return {
    status,
    ok: false,
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : null) },
  }
}

function makeOkResponse(status = 200) {
  return {
    status,
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve('<html></html>'),
  }
}

describe('fetchWithTrace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('no redirect: chain is empty, returns final response', async () => {
    const ok = makeOkResponse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok))

    const result = await fetchWithTrace('https://example.com/')

    expect(result.chain).toHaveLength(0)
    expect(result.finalUrl).toBe('https://example.com/')
    expect(result.finalRes.status).toBe(200)
  })

  it('single redirect: chain has one hop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/new'))
        .mockResolvedValueOnce(makeOkResponse()),
    )

    const result = await fetchWithTrace('https://example.com/old')

    expect(result.chain).toHaveLength(1)
    expect(result.chain[0]).toEqual({
      from: 'https://example.com/old',
      to: 'https://example.com/new',
      status: 301,
    })
    expect(result.finalUrl).toBe('https://example.com/new')
  })

  it('records 302, 307, 308 statuses in chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(302, 'https://example.com/b'))
        .mockResolvedValueOnce(makeRedirectResponse(307, 'https://example.com/c'))
        .mockResolvedValueOnce(makeRedirectResponse(308, 'https://example.com/d'))
        .mockResolvedValueOnce(makeOkResponse()),
    )

    const result = await fetchWithTrace('https://example.com/a')

    expect(result.chain).toHaveLength(3)
    expect(result.chain[0].status).toBe(302)
    expect(result.chain[1].status).toBe(307)
    expect(result.chain[2].status).toBe(308)
  })

  it('resolves relative location header against current URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, '/new-path'))
        .mockResolvedValueOnce(makeOkResponse()),
    )

    const result = await fetchWithTrace('https://example.com/old-path')

    expect(result.chain[0].to).toBe('https://example.com/new-path')
  })

  it('throws UPSTREAM_5XX on redirect loop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/b'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/a')),
      // /a is where we started — loop
    )

    await expect(fetchWithTrace('https://example.com/a')).rejects.toSatisfy(
      (e: unknown) => e instanceof ToolError && e.code === ErrorCode.UPSTREAM_5XX && /loop/i.test(e.message),
    )
  })

  it('throws UPSTREAM_5XX when hop limit (5) exceeded', async () => {
    const mockFetch = vi.fn()
    // 5 redirects: a→b→c→d→e→f, then would need 6th fetch
    mockFetch
      .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/b'))
      .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/c'))
      .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/d'))
      .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/e'))
      .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/f'))
    // 6th call would be for /f but it should throw before fetching
    vi.stubGlobal('fetch', mockFetch)

    await expect(fetchWithTrace('https://example.com/a')).rejects.toSatisfy(
      (e: unknown) => e instanceof ToolError && e.code === ErrorCode.UPSTREAM_5XX && /hop limit/i.test(e.message),
    )
  })

  it('uses redirect: manual when calling fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse())
    vi.stubGlobal('fetch', mockFetch)

    await fetchWithTrace('https://example.com/')

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(opts.redirect).toBe('manual')
  })

  it('passes caller options (headers) through to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse())
    vi.stubGlobal('fetch', mockFetch)

    await fetchWithTrace('https://example.com/', { headers: { 'User-Agent': 'TestBot/1.0' } })

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['User-Agent']).toBe('TestBot/1.0')
    // redirect: manual must still be set
    expect(opts.redirect).toBe('manual')
  })

  it('returns without following if redirect has no Location header', async () => {
    const noLocation = {
      status: 301,
      ok: false,
      headers: { get: () => null },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(noLocation))

    const result = await fetchWithTrace('https://example.com/')

    expect(result.chain).toHaveLength(0)
    expect(result.finalUrl).toBe('https://example.com/')
    expect(result.finalRes.status).toBe(301)
  })
})
