import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHtml } from './cloudflare-render.js'
import { ErrorCode } from './errors.js'

// Every test uses a distinct URL so the module-level renderCache never collides
// across tests (there is no public reset — matching seo-page-audit's psiCache).
describe('renderHtml', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.CF_ACCOUNT_ID
    delete process.env.CF_API_TOKEN
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  it('throws AUTH_DENIED when no credentials are available', async () => {
    await expect(renderHtml('https://example.com/')).rejects.toMatchObject({
      code: ErrorCode.AUTH_DENIED,
    })
  })

  it('posts to the Browser Rendering content endpoint with Bearer auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: '<html>rendered</html>' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const html = await renderHtml('https://example.com/page', { accountId: 'acct-1', apiToken: 'token-1' })

    expect(html).toBe('<html>rendered</html>')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct-1/browser-rendering/content')
    expect(init.headers.Authorization).toBe('Bearer token-1')
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com/page' })
  })

  it('falls back to CF_ACCOUNT_ID/CF_API_TOKEN env vars', async () => {
    process.env.CF_ACCOUNT_ID = 'env-acct'
    process.env.CF_API_TOKEN = 'env-token'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: '<html>ok</html>' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await renderHtml('https://example.com/env-page')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/env-acct/browser-rendering/content')
    expect(init.headers.Authorization).toBe('Bearer env-token')
  })

  it('maps a non-ok HTTP response to a ToolError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('forbidden') }),
    )

    await expect(renderHtml('https://example.com/', { accountId: 'a', apiToken: 't' })).rejects.toMatchObject({
      code: ErrorCode.AUTH_DENIED,
    })
  })

  it('caches a successful render for repeat calls to the same URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, result: '<html>cached</html>' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await renderHtml('https://example.com/cache-me', { accountId: 'a', apiToken: 't' })
    await renderHtml('https://example.com/cache-me', { accountId: 'a', apiToken: 't' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws when Cloudflare reports success:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: false, errors: [{ code: 1, message: 'boom' }] }),
      }),
    )

    await expect(renderHtml('https://example.com/', { accountId: 'a', apiToken: 't' })).rejects.toThrow(/boom/)
  })
})
