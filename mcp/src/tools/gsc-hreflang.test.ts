import { describe, it, expect } from 'vitest'
import { buildHreflangArgs, gscHreflangInputSchema, gscHreflangTool, parseHreflangOutput } from './gsc-hreflang.js'

describe('gscHreflangInputSchema', () => {
  it('applies defaults', () => {
    const parsed = gscHreflangInputSchema.parse({ config: 'c.yaml' })
    expect(parsed).toMatchObject({ days: 28, max_pages: 50, min_impressions: 10 })
  })

  it('rejects max_pages below 1', () => {
    expect(gscHreflangInputSchema.safeParse({ config: 'c.yaml', max_pages: 0 }).success).toBe(false)
  })
})

describe('buildHreflangArgs', () => {
  it('builds the gsc hreflang invocation', () => {
    expect(
      buildHreflangArgs(gscHreflangInputSchema.parse({ config: 'configs/x.yaml', days: 90, max_pages: 20, min_impressions: 5 })),
    ).toEqual([
      'hreflang',
      '--config',
      'configs/x.yaml',
      '--format',
      'json',
      '--days',
      '90',
      '--max-pages',
      '20',
      '--min-impressions',
      '5',
    ])
  })
})

describe('parseHreflangOutput', () => {
  const valid = {
    command: 'gsc_hreflang',
    site: 'sc-domain:x.app',
    generated_at: '2026-09-27T12:00:00Z',
    results: [
      {
        pair: { en: 'https://www.x.app/a', es: 'https://www.x.app/b' },
        page: 'https://www.x.app/b',
        issue: 'cross_language_ranking',
        severity: 'warning',
        detail: 'en query ranks on the es page; the en page should rank instead.',
        query: 'mortgage payment simulator',
        expected_page: 'https://www.x.app/a',
        impressions: 29,
      },
    ],
    pages_fetched: 2,
    quota_used: 1,
  }

  it('parses a valid envelope', () => {
    const out = parseHreflangOutput(JSON.stringify(valid))
    expect(out.results[0].expected_page).toBe('https://www.x.app/a')
    expect(out.pages_fetched).toBe(2)
  })

  it('requires pages_fetched', () => {
    const withoutPagesFetched: Partial<typeof valid> = { ...valid }
    delete withoutPagesFetched.pages_fetched
    expect(() => parseHreflangOutput(JSON.stringify(withoutPagesFetched))).toThrow(/pages_fetched/)
  })

  it('throws on the wrong command', () => {
    expect(() => parseHreflangOutput(JSON.stringify({ ...valid, command: 'gsc_url_hygiene' }))).toThrow(/gsc_hreflang/)
  })
})

describe('gscHreflangTool definition', () => {
  it('is read-only and requires config', () => {
    expect(gscHreflangTool.name).toBe('gsc_hreflang')
    expect(gscHreflangTool.annotations.readOnlyHint).toBe(true)
    expect(gscHreflangTool.inputSchema.required).toContain('config')
  })
})
