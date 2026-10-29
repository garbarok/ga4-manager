import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { ErrorCode } from '../utils/errors.js'
import { dataforseoRequestInputSchema, runDataforseoRequest } from './dataforseo-request.js'

function okResponse(result: unknown[], cost = 0.02) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        status_code: 20000,
        status_message: 'Ok.',
        cost,
        tasks: [{ status_code: 20000, status_message: 'Ok.', cost, result }],
      }),
  }
}

describe('runDataforseoRequest', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, DATAFORSEO_USERNAME: 'u', DATAFORSEO_PASSWORD: 'p', DATAFORSEO_ALLOW_RAW: '1' }
  })

  afterEach(() => {
    process.env = OLD_ENV
    vi.unstubAllGlobals()
  })

  const parse = (raw: Record<string, unknown>) => dataforseoRequestInputSchema.parse(raw)

  it('refuses without a network call when the gate is off', async () => {
    for (const value of [undefined, '', '0', 'false']) {
      if (value === undefined) delete process.env.DATAFORSEO_ALLOW_RAW
      else process.env.DATAFORSEO_ALLOW_RAW = value
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const result = await runDataforseoRequest(parse({ path: 'serp/google/organic/live/advanced' }))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
        expect(JSON.stringify(result.error)).toContain('DATAFORSEO_ALLOW_RAW')
      }
      expect(mockFetch).not.toHaveBeenCalled()
    }
  })

  it.each(['1', 'true', 'TRUE'])('calls the endpoint when DATAFORSEO_ALLOW_RAW=%s', async (value) => {
    process.env.DATAFORSEO_ALLOW_RAW = value
    const mockFetch = vi.fn().mockResolvedValue(okResponse([{ keyword: 'a' }]))
    vi.stubGlobal('fetch', mockFetch)

    const result = await runDataforseoRequest(parse({ path: 'serp/google/organic/live/advanced', task: { keyword: 'a' } }))

    expect(result).toEqual({
      success: true,
      path: 'serp/google/organic/live/advanced',
      items: [{ keyword: 'a' }],
      item_count: 1,
      truncated: false,
      cost_usd: 0.02,
    })
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced')
    expect(mockFetch.mock.calls[0][1].method).toBe('POST')
    expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify([{ keyword: 'a' }]))
  })

  it('sends GET without a body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse([{ login: 'me' }], 0))
    vi.stubGlobal('fetch', mockFetch)

    await runDataforseoRequest(parse({ path: 'appendix/user_data', method: 'GET' }))

    expect(mockFetch.mock.calls[0][1].method).toBe('GET')
    expect(mockFetch.mock.calls[0][1].body).toBeUndefined()
  })

  it('validates the path', () => {
    for (const path of ['', '/serp/google', 'serp/google/', '../v2/x', 'serp//google', 'Serp/Google', 'serp/google?x=1', 'serp/google.json']) {
      expect(dataforseoRequestInputSchema.safeParse({ path }).success, path).toBe(false)
    }
    for (const path of ['appendix/user_data', 'serp/google/organic/live/advanced', 'backlinks/summary/live']) {
      expect(dataforseoRequestInputSchema.safeParse({ path }).success, path).toBe(true)
    }
  })

  it('defaults to POST / 100 items and caps max_items at 1000', () => {
    const parsed = parse({ path: 'a/b' })
    expect(parsed.method).toBe('POST')
    expect(parsed.max_items).toBe(100)
    expect(dataforseoRequestInputSchema.safeParse({ path: 'a/b', max_items: 1001 }).success).toBe(false)
  })

  it('truncates nested result items and reports the full count', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ keyword: `k${i}` }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse([{ total_count: 5, items: rows }])))

    const result = await runDataforseoRequest(parse({ path: 'dataforseo_labs/google/ranked_keywords/live', max_items: 2 }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.items).toEqual([{ total_count: 5, items: rows.slice(0, 2) }])
      expect(result.item_count).toBe(5)
      expect(result.truncated).toBe(true)
    }
  })

  it('truncates a flat result array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse([{ a: 1 }, { a: 2 }, { a: 3 }])))

    const result = await runDataforseoRequest(parse({ path: 'x/y', max_items: 2 }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.items).toEqual([{ a: 1 }, { a: 2 }])
      expect(result.item_count).toBe(3)
      expect(result.truncated).toBe(true)
    }
  })

  it('maps a failed task to a tool failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field' }] }),
      }),
    )

    const result = await runDataforseoRequest(parse({ path: 'x/y' }))

    expect(result.success).toBe(false)
  })

  it('reports cost on a failed task', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field', cost: 0.01 }] }),
      }),
    )

    const result = await runDataforseoRequest(parse({ path: 'x/y' }))

    expect(result.success).toBe(false)
    expect(result).toMatchObject({ cost_usd: 0.01 })
  })

  it.each(['serp/google/organic/task_post', 'serp/google/organic/task_get/advanced', 'serp/google/organic/tasks_ready', 'on_page/task_post'])(
    'refuses task endpoint %s without a network call',
    async (path) => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const result = await runDataforseoRequest(parse({ path }))

      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
      expect(mockFetch).not.toHaveBeenCalled()
    },
  )
})
