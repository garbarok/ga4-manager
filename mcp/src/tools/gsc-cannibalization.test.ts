import { describe, it, expect } from 'vitest'
import {
  gscCannibalizationInputSchema,
  gscCannibalizationTool,
  buildCannibalizationArgs,
  parseCannibalizationOutput,
  GscCannibalizationInput,
} from './gsc-cannibalization.js'

describe('gscCannibalizationInputSchema', () => {
  it('accepts a config path with default min_impressions, days, and with_coverage_state', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({
      config: 'configs/mysite.yaml',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.min_impressions).toBe(10)
      expect(parsed.data.days).toBe(28)
      expect(parsed.data.with_coverage_state).toBe(false)
    }
  })

  it('rejects days below 1 or above 485', () => {
    expect(
      gscCannibalizationInputSchema.safeParse({ config: 'x', days: 0 }).success,
    ).toBe(false)
    expect(
      gscCannibalizationInputSchema.safeParse({ config: 'x', days: 486 }).success,
    ).toBe(false)
  })

  it('accepts a custom min_impressions', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({
      config: 'configs/mysite.yaml',
      min_impressions: 25,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.min_impressions).toBe(25)
    }
  })

  it('rejects missing config', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it('rejects empty config string', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({ config: '' })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-integer min_impressions', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({
      config: 'configs/mysite.yaml',
      min_impressions: 9.5,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects min_impressions below 1', () => {
    const parsed = gscCannibalizationInputSchema.safeParse({
      config: 'configs/mysite.yaml',
      min_impressions: 0,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('buildCannibalizationArgs', () => {
  it('always passes config, json format, min-impressions, and days', () => {
    const args = buildCannibalizationArgs({
      config: 'configs/mysite.yaml',
      min_impressions: 10,
      days: 28,
      with_coverage_state: false,
    } as GscCannibalizationInput)
    expect(args).toEqual([
      'cannibalization',
      '--config',
      'configs/mysite.yaml',
      '--format',
      'json',
      '--min-impressions',
      '10',
      '--days',
      '28',
    ])
  })

  it('passes a non-default min_impressions verbatim', () => {
    const args = buildCannibalizationArgs({
      config: 'configs/mysite.yaml',
      min_impressions: 25,
      days: 28,
      with_coverage_state: false,
    } as GscCannibalizationInput)
    expect(args).toContain('--min-impressions')
    expect(args).toContain('25')
  })

  it('passes a non-default days verbatim', () => {
    const args = buildCannibalizationArgs({
      config: 'configs/mysite.yaml',
      min_impressions: 10,
      days: 90,
      with_coverage_state: false,
    } as GscCannibalizationInput)
    expect(args).toContain('--days')
    expect(args).toContain('90')
  })

  it('appends --with-coverage-state when true; omits when false', () => {
    const on = buildCannibalizationArgs({
      config: 'configs/mysite.yaml',
      min_impressions: 10,
      days: 28,
      with_coverage_state: true,
    } as GscCannibalizationInput)
    expect(on).toContain('--with-coverage-state')

    const off = buildCannibalizationArgs({
      config: 'configs/mysite.yaml',
      min_impressions: 10,
      days: 28,
      with_coverage_state: false,
    } as GscCannibalizationInput)
    expect(off).not.toContain('--with-coverage-state')
  })
})

describe('parseCannibalizationOutput', () => {
  it('parses a valid CLI JSON envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_cannibalization',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [
        {
          query: 'widgets',
          pages: [
            { page: 'https://example.com/a', impressions: 50 },
            { page: 'https://example.com/b', impressions: 30 },
          ],
          total_impressions: 80,
          canonical_candidate: 'https://example.com/a',
        },
      ],
      quota_used: 1,
    })

    const out = parseCannibalizationOutput(stdout)
    expect(out.command).toBe('gsc_cannibalization')
    expect(out.site).toBe('sc-domain:example.com')
    expect(out.quota_used).toBe(1)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].canonical_candidate).toBe('https://example.com/a')
    expect(out.results[0].pages[0].impressions).toBe(50)
  })

  it('parses an empty-results envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_cannibalization',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [],
      quota_used: 1,
    })
    const out = parseCannibalizationOutput(stdout)
    expect(out.results).toEqual([])
    expect(out.quota_used).toBe(1)
  })

  it('throws when stdout is not valid JSON', () => {
    expect(() => parseCannibalizationOutput('garbled non-json output')).toThrow()
  })

  it('throws when the command field is wrong', () => {
    const stdout = JSON.stringify({
      command: 'other_tool',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [],
      quota_used: 0,
    })
    expect(() => parseCannibalizationOutput(stdout)).toThrow(/Unexpected command/)
  })

  it('throws when required fields are missing', () => {
    const stdout = JSON.stringify({ command: 'gsc_cannibalization' })
    expect(() => parseCannibalizationOutput(stdout)).toThrow()
  })
})

describe('gscCannibalizationTool definition', () => {
  it('has the registered tool name', () => {
    expect(gscCannibalizationTool.name).toBe('gsc_cannibalization')
  })

  it('describes the cannibalisation predicate', () => {
    expect(gscCannibalizationTool.description.toLowerCase()).toContain('search console')
    expect(gscCannibalizationTool.description.toLowerCase()).toContain('cannibal')
  })

  it('declares config and min_impressions as arguments', () => {
    const props = gscCannibalizationTool.inputSchema.properties as Record<
      string,
      { type: string }
    >
    expect(props.config).toBeDefined()
    expect(props.config.type).toBe('string')
    expect(props.min_impressions).toBeDefined()
    expect(props.min_impressions.type).toBe('number')
  })

  it('marks config as required', () => {
    expect(gscCannibalizationTool.inputSchema.required).toContain('config')
  })
})

describe('JSON shape parity with the CLI envelope', () => {
  it('round-trips the same shape the Go CLI emits', () => {
    // Mirrors cmd/gsc_cannibalization.go CannibalizationOutput verbatim.
    const cliEnvelope = {
      command: 'gsc_cannibalization',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [
        {
          query: 'gadgets',
          pages: [
            { page: 'https://example.com/c', impressions: 200 },
            { page: 'https://example.com/d', impressions: 150 },
          ],
          total_impressions: 350,
          canonical_candidate: 'https://example.com/c',
        },
      ],
      quota_used: 1,
    }
    const parsed = parseCannibalizationOutput(JSON.stringify(cliEnvelope))
    expect(parsed).toEqual(cliEnvelope)
  })
})
