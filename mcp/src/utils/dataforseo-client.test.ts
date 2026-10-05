import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dataforseoPost } from './dataforseo-client.js'
import { ErrorCode } from './errors.js'

describe('dataforseoPost', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    delete process.env.DATAFORSEO_USERNAME
    delete process.env.DATAFORSEO_PASSWORD
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  it('throws AUTH_DENIED when no credentials are available', async () => {
    await expect(dataforseoPost('keywords_data/google_ads/search_volume/live', { keywords: ['x'] })).rejects.toMatchObject({
      code: ErrorCode.AUTH_DENIED,
    })
  })

  it('sends Basic auth built from the login/password pair and the task wrapped in an array', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status_code: 20000,
          status_message: 'Ok.',
          tasks: [{ status_code: 20000, status_message: 'Ok.', result: [{ keyword: 'x', search_volume: 100 }] }],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await dataforseoPost('keywords_data/google_ads/search_volume/live', { keywords: ['x'] }, {
      username: 'user1',
      password: 'pass1',
    })

    expect(result).toEqual([{ keyword: 'x', search_volume: 100 }])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('user1:pass1').toString('base64')}`)
    expect(JSON.parse(init.body)).toEqual([{ keywords: ['x'] }])
  })

  it('falls back to DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD env vars', async () => {
    process.env.DATAFORSEO_USERNAME = 'env-user'
    process.env.DATAFORSEO_PASSWORD = 'env-pass'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ status_code: 20000, status_message: 'Ok.', tasks: [{ status_code: 20000, status_message: 'Ok.', result: [] }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await dataforseoPost('keywords_data/google_ads/search_volume/live', { keywords: ['x'] })

    const [, init] = mockFetch.mock.calls[0]
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('env-user:env-pass').toString('base64')}`)
  })

  it('maps a non-ok HTTP response to a ToolError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('unauthorized') }))

    await expect(
      dataforseoPost('keywords_data/google_ads/search_volume/live', { keywords: ['x'] }, { username: 'u', password: 'p' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_DENIED })
  })

  it('throws INVALID_INPUT on a non-20000 task status even with HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status_code: 20000,
            status_message: 'Ok.',
            tasks: [{ status_code: 40501, status_message: 'Invalid Field.' }],
          }),
      }),
    )

    await expect(
      dataforseoPost('keywords_data/google_ads/search_volume/live', { keywords: ['x'] }, { username: 'u', password: 'p' }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT })
  })
})
