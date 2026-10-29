import { describe, it, expect } from 'vitest'
import {
  gscOpportunitiesInputSchema,
  gscOpportunitiesTool,
  buildOpportunitiesArgs,
  parseOpportunitiesOutput,
  GscOpportunitiesInput,
} from './gsc-opportunities.js'

describe('gscOpportunitiesInputSchema', () => {
  it('accepts a config path with documented defaults', () => {
    const parsed = gscOpportunitiesInputSchema.safeParse({ config: 'configs/x.yaml' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.days).toBe(28)
      expect(parsed.data.min_impressions).toBe(20)
      expect(parsed.data.min_potential_clicks).toBe(1)
    }
  })

  it('rejects empty config', () => {
    expect(gscOpportunitiesInputSchema.safeParse({ config: '' }).success).toBe(false)
  })

  it('rejects days outside [1, 485]', () => {
    expect(gscOpportunitiesInputSchema.safeParse({ config: 'x', days: 0 }).success).toBe(false)
    expect(gscOpportunitiesInputSchema.safeParse({ config: 'x', days: 486 }).success).toBe(false)
  })

  it('rejects min_potential_clicks below 0', () => {
    expect(
      gscOpportunitiesInputSchema.safeParse({ config: 'x', min_potential_clicks: -1 }).success,
    ).toBe(false)
  })
})

describe('buildOpportunitiesArgs', () => {
  it('passes every documented arg verbatim', () => {
    const args = buildOpportunitiesArgs({
      config: 'configs/x.yaml',
      days: 90,
      min_impressions: 50,
      min_potential_clicks: 10,
    } as GscOpportunitiesInput)
    expect(args).toEqual([
      'opportunities',
      '--config',
      'configs/x.yaml',
      '--format',
      'json',
      '--days',
      '90',
      '--min-impressions',
      '50',
      '--min-potential-clicks',
      '10',
    ])
  })
})

describe('buildOpportunitiesArgs granularity', () => {
  it('appends --granularity page only in page mode', () => {
    const page = buildOpportunitiesArgs(
      gscOpportunitiesInputSchema.parse({ config: 'c.yaml', granularity: 'page' }),
    )
    expect(page.slice(-2)).toEqual(['--granularity', 'page'])
    const query = buildOpportunitiesArgs(gscOpportunitiesInputSchema.parse({ config: 'c.yaml' }))
    expect(query).not.toContain('--granularity')
  })

  it('rejects an unknown granularity', () => {
    expect(gscOpportunitiesInputSchema.safeParse({ config: 'c.yaml', granularity: 'site' }).success).toBe(false)
  })
})

describe('parseOpportunitiesOutput', () => {
  it('keeps page-mode fields', () => {
    const out = parseOpportunitiesOutput(
      JSON.stringify({
        command: 'gsc_opportunities',
        site: 'sc-domain:x.app',
        generated_at: '2026-09-27T12:00:00Z',
        results: [
          {
            query: '',
            page: 'https://www.x.app/calculator/mortgage-calculator',
            position: 8.8,
            clicks: 500,
            impressions: 100000,
            ctr: 0.005,
            bucket: 9,
            category_median_ctr: 0.035,
            median_source: 'baseline',
            ctr_gap: 0.0292,
            potential_clicks: 3000,
            top_queries: [{ query: 'mortgage calculator', impressions: 10000, clicks: 50, position: 9.7 }],
            anonymized_share: 0.85,
          },
        ],
        quota_used: 2,
      }),
    )
    expect(out.results[0].anonymized_share).toBe(0.85)
    expect(out.results[0].top_queries?.[0].query).toBe('mortgage calculator')
    expect(out.quota_used).toBe(2)
  })

  it('parses a valid CLI envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_opportunities',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [
        {
          query: 'wealth calculator',
          page: 'https://example.com/calculator',
          position: 8.2,
          clicks: 5,
          impressions: 1000,
          ctr: 0.005,
          bucket: 8,
          category_median_ctr: 0.03,
          ctr_gap: 0.025,
          potential_clicks: 25,
        },
      ],
      quota_used: 1,
    })
    const out = parseOpportunitiesOutput(stdout)
    expect(out.command).toBe('gsc_opportunities')
    expect(out.results).toHaveLength(1)
    expect(out.results[0].potential_clicks).toBe(25)
  })

  it('throws on wrong command', () => {
    const stdout = JSON.stringify({
      command: 'other',
      site: 's',
      generated_at: 'g',
      results: [],
      quota_used: 0,
    })
    expect(() => parseOpportunitiesOutput(stdout)).toThrow(/Unexpected command/)
  })

  it('throws on garbled stdout', () => {
    expect(() => parseOpportunitiesOutput('not json')).toThrow()
  })
})

describe('gscOpportunitiesTool definition', () => {
  it('has the registered name', () => {
    expect(gscOpportunitiesTool.name).toBe('gsc_opportunities')
  })

  it('marks config as required', () => {
    expect(gscOpportunitiesTool.inputSchema.required).toContain('config')
  })

  it('declares all five args', () => {
    const props = gscOpportunitiesTool.inputSchema.properties as Record<string, unknown>
    expect(props.config).toBeDefined()
    expect(props.days).toBeDefined()
    expect(props.min_impressions).toBeDefined()
    expect(props.min_potential_clicks).toBeDefined()
    expect(props.granularity).toBeDefined()
  })

  it('mentions potential_clicks in its description so consumers know the ranking key', () => {
    expect(gscOpportunitiesTool.description).toMatch(/potential_clicks/)
  })
})
