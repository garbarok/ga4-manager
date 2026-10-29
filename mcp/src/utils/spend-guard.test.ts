import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { beforePaidCall, recordSpend, resetSpend, readSpendLimits, spendSummary } from './spend-guard.js'
import { ToolError } from './errors.js'
import { dataforseoRequest } from './dataforseo-client.js'

beforeEach(() => resetSpend())

describe('readSpendLimits', () => {
  it('defaults to $5 and 300 calls', () => {
    expect(readSpendLimits({})).toEqual({ max_spend_usd: 5, max_paid_calls: 300 })
  })

  it('treats "" as unset (the .mcpb host passes empty strings) and "off" as no limit', () => {
    expect(readSpendLimits({ GA4M_MAX_SPEND_USD: '', GA4M_MAX_PAID_CALLS: 'OFF' })).toEqual({ max_spend_usd: 5, max_paid_calls: null })
  })

  it('rejects negative or non-numeric values', () => {
    expect(() => readSpendLimits({ GA4M_MAX_SPEND_USD: '-1' })).toThrow(ToolError)
    expect(() => readSpendLimits({ GA4M_MAX_PAID_CALLS: 'lots' })).toThrow(/GA4M_MAX_PAID_CALLS/)
  })
})

describe('beforePaidCall', () => {
  it('refuses once the call cap is reached and counts per provider', () => {
    const env = { GA4M_MAX_PAID_CALLS: '2' }
    beforePaidCall('valueserp', env)
    beforePaidCall('cloudflare', env)
    expect(() => beforePaidCall('dataforseo', env)).toThrow(/limit of 2 paid API calls/)
    expect(spendSummary(env)).toMatchObject({ paid_calls: 2, calls_by_provider: { valueserp: 1, cloudflare: 1, dataforseo: 0 } })
  })

  it('refuses once billed dollars reach the cap', () => {
    const env = { GA4M_MAX_SPEND_USD: '0.5' }
    beforePaidCall('dataforseo', env)
    recordSpend(0.3)
    beforePaidCall('dataforseo', env)
    recordSpend(0.25)
    let err: unknown
    try {
      beforePaidCall('dataforseo', env)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ToolError)
    expect((err as ToolError).code).toBe('QUOTA_EXCEEDED')
    expect((err as ToolError).message).toContain('$0.55 billed')
  })

  it('never blocks when both limits are off', () => {
    const env = { GA4M_MAX_SPEND_USD: 'off', GA4M_MAX_PAID_CALLS: 'off' }
    recordSpend(1000)
    for (let i = 0; i < 1000; i++) beforePaidCall('dataforseo', env)
    expect(spendSummary(env).paid_calls).toBe(1000)
  })

  it('ignores unknown or non-positive costs', () => {
    recordSpend(null)
    recordSpend(-3)
    recordSpend(Number.NaN)
    expect(spendSummary({}).spent_usd).toBe(0)
  })
})

describe('DataForSEO client integration', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    vi.unstubAllGlobals()
  })

  it('records billed cost and refuses before fetching once the cap is hit, but keeps unbilled calls open', async () => {
    process.env.DATAFORSEO_USERNAME = 'u'
    process.env.DATAFORSEO_PASSWORD = 'p'
    process.env.GA4M_MAX_SPEND_USD = '0.01'
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, status_message: 'Ok.', cost: 0.02, result: [{}] }] })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await dataforseoRequest({ path: 'serp/google/organic/live/advanced', task: { keyword: 'x' } })
    expect(spendSummary().spent_usd).toBe(0.02)

    await expect(dataforseoRequest({ path: 'serp/google/organic/live/advanced', task: { keyword: 'y' } })).rejects.toThrow(/spending cap/)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await dataforseoRequest({ method: 'GET', path: 'appendix/user_data', unbilled: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
