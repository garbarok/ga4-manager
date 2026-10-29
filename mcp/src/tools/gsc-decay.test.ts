import { describe, it, expect } from 'vitest'
import {
  gscDecayInputSchema,
  gscDecayTool,
  buildDecayArgs,
  parseDecayOutput,
  GscDecayInput,
} from './gsc-decay.js'

describe('gscDecayInputSchema', () => {
  it('applies defaults', () => {
    const parsed = gscDecayInputSchema.safeParse({ config: 'x.yaml' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.days).toBe(28)
      expect(parsed.data.min_clicks_prior).toBe(5)
      expect(parsed.data.min_clicks_lost).toBe(0)
    }
  })

  it('rejects empty config', () => {
    expect(gscDecayInputSchema.safeParse({ config: '' }).success).toBe(false)
  })

  it('rejects days outside [1, 240]', () => {
    expect(gscDecayInputSchema.safeParse({ config: 'x', days: 0 }).success).toBe(false)
    expect(gscDecayInputSchema.safeParse({ config: 'x', days: 241 }).success).toBe(false)
  })
})

describe('buildDecayArgs', () => {
  it('passes every documented arg verbatim', () => {
    const args = buildDecayArgs({
      config: 'configs/x.yaml',
      days: 90,
      min_clicks_prior: 20,
      min_clicks_lost: 50,
    } as GscDecayInput)
    expect(args).toEqual([
      'decay',
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

describe('parseDecayOutput', () => {
  it('parses a valid envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_decay',
      site: 'sc-domain:example.com',
      generated_at: '2026-10-29T12:00:00Z',
      results: [
        {
          query: 'q',
          page: 'p',
          position_current: 7,
          position_prior: 5,
          position_delta: 2,
          clicks_current: 50,
          clicks_prior: 100,
          clicks_delta: -0.5,
          clicks_lost: 50,
          impressions_current: 900,
          impressions_prior: 1000,
        },
      ],
      quota_used: 2,
    })
    const out = parseDecayOutput(stdout)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].clicks_lost).toBe(50)
    expect(out.quota_used).toBe(2)
  })

  it('throws on wrong command', () => {
    expect(() =>
      parseDecayOutput(
        JSON.stringify({ command: 'other', site: 's', generated_at: 'g', results: [], quota_used: 0 }),
      ),
    ).toThrow(/Unexpected command/)
  })

  it('throws on missing results', () => {
    expect(() =>
      parseDecayOutput(JSON.stringify({ command: 'gsc_decay', site: 's', generated_at: 'g' })),
    ).toThrow(/missing results/)
  })

  it('throws on garbled stdout', () => {
    expect(() => parseDecayOutput('not json')).toThrow()
  })
})

describe('gscDecayTool definition', () => {
  it('has the registered name', () => {
    expect(gscDecayTool.name).toBe('gsc_decay')
  })

  it('declares all four args', () => {
    const props = gscDecayTool.inputSchema.properties as Record<string, unknown>
    expect(props.config).toBeDefined()
    expect(props.days).toBeDefined()
    expect(props.min_clicks_prior).toBeDefined()
    expect(props.min_clicks_lost).toBeDefined()
  })

  it('mentions clicks_lost in description so consumers know the sort key', () => {
    expect(gscDecayTool.description).toMatch(/clicks_lost/)
  })

  it('is read-only', () => {
    expect(gscDecayTool.annotations.readOnlyHint).toBe(true)
  })
})
