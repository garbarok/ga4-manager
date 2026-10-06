import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { llmMentionsInputSchema, runLlmMentions } from './llm-mentions.js'

vi.mock('../utils/dataforseo-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/dataforseo-client.js')>()),
  dataforseoRequest: vi.fn(),
}))

const mockRequest = vi.mocked(dataforseoRequest)

beforeEach(() => {
  mockRequest.mockReset()
})

const answer = (sources: { domain: string; url: string }[], text = 'Some answer') => ({ answer: text, sources })

describe('llmMentionsInputSchema', () => {
  it('rejects more than 20 keywords', () => {
    const r = llmMentionsInputSchema.safeParse({ domain: 'a.com', keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) })
    expect(r.success).toBe(false)
  })

  it('rejects a limit above 100', () => {
    expect(llmMentionsInputSchema.safeParse({ domain: 'a.com', keywords: ['x'], limit: 5000 }).success).toBe(false)
  })
})

describe('runLlmMentions', () => {
  it('marks a keyword as mentioned when an AI answer cites the target', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ items: [answer([{ domain: 'example.com', url: 'https://example.com/coast-fire' }, { domain: 'rival.io', url: 'https://rival.io/' }])] }],
      cost: 0.1,
    } as never)

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'example.com', keywords: ['coast fire calculator'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[0].target_mentioned).toBe(true)
      expect(result.results[0].target_citations).toEqual(['https://example.com/coast-fire'])
      expect(result.cost_usd).toBe(0.1)
    }
    expect(mockRequest.mock.calls[0][0].task).toMatchObject({ target: [{ keyword: 'coast fire calculator' }], platform: 'google', limit: 20 })
  })

  it('lists cited domains by count when the target is not cited', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [
        {
          items: [
            answer([{ domain: 'rival.io', url: 'https://rival.io/a' }, { domain: 'other.com', url: 'https://other.com/' }]),
            answer([{ domain: 'www.rival.io', url: 'https://www.rival.io/b' }]),
          ],
        },
      ],
      cost: 0.1,
    } as never)

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'example.com', keywords: ['x'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[0].target_mentioned).toBe(false)
      expect(result.results[0].top_cited_domains).toEqual([
        { domain: 'rival.io', mentions: 2 },
        { domain: 'other.com', mentions: 1 },
      ])
    }
  })

  it('returns target_mentioned null for a keyword with no AI answer data, keeping the others', async () => {
    mockRequest
      .mockResolvedValueOnce({ items: [{ items: [] }], cost: 0.1 } as never)
      .mockResolvedValueOnce({ items: [{ items: [answer([{ domain: 'example.com', url: 'https://example.com/' }])] }], cost: 0.1 } as never)

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'example.com', keywords: ['none', 'some'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[0]).toMatchObject({ keyword: 'none', target_mentioned: null, top_cited_domains: [] })
      expect(result.results[1]).toMatchObject({ keyword: 'some', target_mentioned: true })
      expect(result.cost_usd).toBe(0.2)
    }
  })

  it('normalizes a URL-style target domain', async () => {
    mockRequest.mockResolvedValueOnce({
      items: [{ items: [answer([{ domain: 'example.com', url: 'https://example.com/guide' }])] }],
      cost: 0.1,
    } as never)

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'https://www.Example.com/calc', keywords: ['x'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.domain).toBe('example.com')
      expect(result.results[0].target_mentioned).toBe(true)
    }
  })

  it('surfaces the DataForSEO error when every request fails', async () => {
    mockRequest.mockRejectedValue(new ToolError(ErrorCode.INVALID_INPUT, 'DataForSEO task failed: Insufficient funds.'))

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'example.com', keywords: ['a', 'b'] }))

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.message).toContain('Insufficient funds')
  })

  it('keeps successful keywords and marks the failed one with an error', async () => {
    mockRequest
      .mockResolvedValueOnce({ items: [{ items: [] }], cost: 0.1 } as never)
      .mockRejectedValueOnce(new ToolError(ErrorCode.UPSTREAM_5XX, 'timeout'))

    const result = await runLlmMentions(llmMentionsInputSchema.parse({ domain: 'example.com', keywords: ['a', 'b'] }))

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.results[1]).toMatchObject({ keyword: 'b', error: 'timeout' })
      expect(result.cost_usd).toBe(0.1)
    }
  })
})
