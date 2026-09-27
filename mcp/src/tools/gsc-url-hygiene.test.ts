import { describe, it, expect } from 'vitest'
import {
  buildUrlHygieneArgs,
  gscUrlHygieneInputSchema,
  gscUrlHygieneTool,
  parseUrlHygieneOutput,
} from './gsc-url-hygiene.js'

describe('gscUrlHygieneInputSchema', () => {
  it('defaults days to 90', () => {
    expect(gscUrlHygieneInputSchema.parse({ config: 'c.yaml' }).days).toBe(90)
  })

  it('rejects days outside [1, 485]', () => {
    expect(gscUrlHygieneInputSchema.safeParse({ config: 'c.yaml', days: 0 }).success).toBe(false)
    expect(gscUrlHygieneInputSchema.safeParse({ config: 'c.yaml', days: 486 }).success).toBe(false)
  })
})

describe('buildUrlHygieneArgs', () => {
  it('builds the gsc url-hygiene invocation', () => {
    expect(buildUrlHygieneArgs(gscUrlHygieneInputSchema.parse({ config: 'configs/x.yaml', days: 180 }))).toEqual([
      'url-hygiene',
      '--config',
      'configs/x.yaml',
      '--format',
      'json',
      '--days',
      '180',
    ])
  })
})

describe('parseUrlHygieneOutput', () => {
  it('parses a valid envelope', () => {
    const out = parseUrlHygieneOutput(
      JSON.stringify({
        command: 'gsc_url_hygiene',
        site: 'sc-domain:x.app',
        generated_at: '2026-09-27T12:00:00Z',
        results: [
          {
            url: 'https://www.x.app/www.x.app/calculator/a',
            issue: 'malformed_path',
            severity: 'warning',
            impressions: 1,
            clicks: 0,
            fix: 'Find the link that produced this path',
          },
        ],
        quota_used: 1,
      }),
    )
    expect(out.results[0].issue).toBe('malformed_path')
    expect(out.quota_used).toBe(1)
  })

  it('throws on the wrong command', () => {
    expect(() =>
      parseUrlHygieneOutput(
        JSON.stringify({ command: 'gsc_opportunities', site: 's', generated_at: 'g', results: [], quota_used: 1 }),
      ),
    ).toThrow(/gsc_url_hygiene/)
  })

  it('throws on a missing results array', () => {
    expect(() =>
      parseUrlHygieneOutput(JSON.stringify({ command: 'gsc_url_hygiene', site: 's', generated_at: 'g', quota_used: 1 })),
    ).toThrow(/results/)
  })
})

describe('gscUrlHygieneTool definition', () => {
  it('is read-only and requires config', () => {
    expect(gscUrlHygieneTool.name).toBe('gsc_url_hygiene')
    expect(gscUrlHygieneTool.annotations.readOnlyHint).toBe(true)
    expect(gscUrlHygieneTool.inputSchema.required).toContain('config')
  })
})
