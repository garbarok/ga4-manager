import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ErrorCode } from '../utils/errors.js'
import { runDataforseoBalance } from './dataforseo-balance.js'

describe('runDataforseoBalance', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, DATAFORSEO_USERNAME: 'u', DATAFORSEO_PASSWORD: 'p' }
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  it('returns the balance from appendix/user_data at zero cost', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          tasks: [{ status_code: 20000, status_message: 'Ok.', cost: 0, result: [{ login: 'me', money: { total: 50, balance: 49.43 } }] }],
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await runDataforseoBalance()

    expect(result).toEqual({ success: true, login: 'me', balance_usd: 49.43, total_deposited_usd: 50, cost_usd: 0 })
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.dataforseo.com/v3/appendix/user_data')
    expect(mockFetch.mock.calls[0][1].method).toBe('GET')
  })

  it('fails with AUTH_DENIED and no network call when credentials are missing', async () => {
    delete process.env.DATAFORSEO_USERNAME
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const result = await runDataforseoBalance()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.AUTH_DENIED)
      expect(JSON.stringify(result.error)).toContain('PERMISSIONS.md#dataforseo')
    }
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
