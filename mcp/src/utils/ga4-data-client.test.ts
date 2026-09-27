import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runReport } from './ga4-data-client.js'
import { ToolError, ErrorCode } from './errors.js'

vi.mock('./google-auth.js', () => ({
  getGoogleAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function failureFor(status: number, body = ''): Promise<ToolError> {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }))
  try {
    await runReport('properties/1', {})
  } catch (err) {
    return err as ToolError
  }
  throw new Error('expected runReport to throw')
}

describe('runReport', () => {
  it('POSTs the body to the property runReport endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"rows":[]}', { status: 200 }))
    const data = await runReport('properties/42', { limit: 5 })
    expect(data.rows).toEqual([])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/42:runReport')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ limit: 5 })
  })

  it('maps a 400 to INVALID_INPUT, not UPSTREAM_5XX', async () => {
    const err = await failureFor(400, 'Field fooBar is not a valid metric')
    expect(err.code).toBe(ErrorCode.INVALID_INPUT)
    expect(err.message).toContain('fooBar')
  })

  it('maps 403 to AUTH_DENIED with a permissions hint', async () => {
    const err = await failureFor(403)
    expect(err.code).toBe(ErrorCode.AUTH_DENIED)
    expect(err.hint).toContain('PERMISSIONS.md')
  })

  it('maps 404 to NOT_FOUND, 429 to QUOTA_EXCEEDED, 500 to UPSTREAM_5XX', async () => {
    expect((await failureFor(404)).code).toBe(ErrorCode.NOT_FOUND)
    expect((await failureFor(429)).code).toBe(ErrorCode.QUOTA_EXCEEDED)
    expect((await failureFor(500)).code).toBe(ErrorCode.UPSTREAM_5XX)
  })
})
