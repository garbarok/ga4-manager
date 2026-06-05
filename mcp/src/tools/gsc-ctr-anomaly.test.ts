import { describe, it, expect } from 'vitest'
import {
  gscCTRAnomalyInputSchema,
  gscCTRAnomalyTool,
  buildCTRAnomalyArgs,
  parseCTRAnomalyOutput,
  GscCTRAnomalyInput,
} from './gsc-ctr-anomaly.js'

describe('gscCTRAnomalyInputSchema', () => {
  it('applies defaults', () => {
    const parsed = gscCTRAnomalyInputSchema.safeParse({ config: 'x.yaml' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.days).toBe(28)
      expect(parsed.data.min_clicks_prior).toBe(5)
      expect(parsed.data.min_clicks_lost).toBe(0)
    }
  })

  it('rejects empty config', () => {
    expect(gscCTRAnomalyInputSchema.safeParse({ config: '' }).success).toBe(false)
  })

  it('rejects days outside [1, 240]', () => {
    expect(gscCTRAnomalyInputSchema.safeParse({ config: 'x', days: 0 }).success).toBe(false)
    expect(gscCTRAnomalyInputSchema.safeParse({ config: 'x', days: 241 }).success).toBe(false)
  })
})

describe('buildCTRAnomalyArgs', () => {
  it('passes every documented arg verbatim', () => {
    const args = buildCTRAnomalyArgs({
      config: 'configs/x.yaml',
      days: 90,
      min_clicks_prior: 20,
      min_clicks_lost: 50,
    } as GscCTRAnomalyInput)
    expect(args).toEqual([
      'ctr-anomaly',
      '--config',
      'configs/x.yaml',
      '--format',
      'json',
      '--days',
      '90',
      '--min-clicks-prior',
      '20',
      '--min-clicks-lost',
      '50',
    ])
  })
})

describe('parseCTRAnomalyOutput', () => {
  it('parses a valid envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_ctr_anomaly',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [
        {
          query: 'q',
          page: 'p',
          position_current: 7.2,
          position_prior: 7.0,
          position_delta: 0.2,
          ctr_current: 0.03,
          ctr_prior: 0.08,
          ctr_delta: -0.625,
          clicks_current: 30,
          clicks_prior: 80,
          clicks_lost: 50,
          impressions_current: 1000,
          impressions_prior: 1000,
        },
      ],
      quota_used: 2,
    })
    const out = parseCTRAnomalyOutput(stdout)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].clicks_lost).toBe(50)
    expect(out.quota_used).toBe(2)
  })

  it('throws on wrong command', () => {
    expect(() =>
      parseCTRAnomalyOutput(
        JSON.stringify({ command: 'other', site: 's', generated_at: 'g', results: [], quota_used: 0 }),
      ),
    ).toThrow(/Unexpected command/)
  })

  it('throws on garbled stdout', () => {
    expect(() => parseCTRAnomalyOutput('not json')).toThrow()
  })
})

describe('gscCTRAnomalyTool definition', () => {
  it('has the registered name', () => {
    expect(gscCTRAnomalyTool.name).toBe('gsc_ctr_anomaly')
  })

  it('declares all four args', () => {
    const props = gscCTRAnomalyTool.inputSchema.properties as Record<string, unknown>
    expect(props.config).toBeDefined()
    expect(props.days).toBeDefined()
    expect(props.min_clicks_prior).toBeDefined()
    expect(props.min_clicks_lost).toBeDefined()
  })

  it('mentions clicks_lost in description so consumers know the sort key', () => {
    expect(gscCTRAnomalyTool.description).toMatch(/clicks_lost/)
  })
})
