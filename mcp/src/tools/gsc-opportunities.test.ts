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

describe('parseOpportunitiesOutput', () => {
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

  it('declares all four args', () => {
    const props = gscOpportunitiesTool.inputSchema.properties as Record<string, unknown>
    expect(props.config).toBeDefined()
    expect(props.days).toBeDefined()
    expect(props.min_impressions).toBeDefined()
    expect(props.min_potential_clicks).toBeDefined()
  })

  it('mentions potential_clicks in its description so consumers know the ranking key', () => {
    expect(gscOpportunitiesTool.description).toMatch(/potential_clicks/)
  })
})
