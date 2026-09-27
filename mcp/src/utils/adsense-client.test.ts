import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adsenseGet } from './adsense-client.js'
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

function respond(status: number, body: string) {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }))
}

async function failure(): Promise<ToolError> {
  try {
    await adsenseGet('accounts/pub-1/reports:generate')
  } catch (err) {
    return err as ToolError
  }
  throw new Error('expected adsenseGet to throw')
}

describe('adsenseGet error mapping', () => {
  it('maps a 400 INVALID_ARGUMENT to INVALID_INPUT with the upstream message', async () => {
    respond(400, '{"error":{"status":"INVALID_ARGUMENT","message":"Invalid value at date_range"}}')
    const err = await failure()
    expect(err.code).toBe(ErrorCode.INVALID_INPUT)
    expect(err.message).toContain('Invalid value at date_range')
  })

  it('maps a 503 to UPSTREAM_5XX', async () => {
    respond(503, 'unavailable')
    expect((await failure()).code).toBe(ErrorCode.UPSTREAM_5XX)
  })

  it('keeps the scope hint on 401', async () => {
    respond(401, '')
    const err = await failure()
    expect(err.code).toBe(ErrorCode.AUTH_DENIED)
    expect(err.hint).toContain('adsense.readonly')
  })

  it('repeats array query params', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await adsenseGet('x', { orderBy: ['-A', '+B'] })
    expect(String(fetchMock.mock.calls[0][0])).toContain('orderBy=-A&orderBy=%2BB')
  })
})
