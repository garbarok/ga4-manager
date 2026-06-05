import { describe, it, expect } from 'vitest'
import {
  gscHealthInputSchema,
  gscHealthTool,
  buildHealthArgs,
  parseHealthOutput,
  GscHealthInput,
} from './gsc-health.js'

describe('gscHealthInputSchema', () => {
  it('accepts a config path with default flags', () => {
    const parsed = gscHealthInputSchema.safeParse({ config: 'configs/x.yaml' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.dry_run).toBe(false)
      expect(parsed.data.state_dir).toBeUndefined()
    }
  })

  it('rejects empty config', () => {
    expect(gscHealthInputSchema.safeParse({ config: '' }).success).toBe(false)
  })
})

describe('buildHealthArgs', () => {
  it('omits optional flags when unset', () => {
    const args = buildHealthArgs({
      config: 'configs/x.yaml',
      dry_run: false,
    } as GscHealthInput)
    expect(args).toEqual(['health', '--config', 'configs/x.yaml', '--format', 'json'])
  })

  it('appends --state-dir when provided', () => {
    const args = buildHealthArgs({
      config: 'configs/x.yaml',
      state_dir: '/var/lib/ga4-state',
      dry_run: false,
    } as GscHealthInput)
    expect(args).toContain('--state-dir')
    expect(args).toContain('/var/lib/ga4-state')
  })

  it('appends --dry-run when true', () => {
    const args = buildHealthArgs({
      config: 'configs/x.yaml',
      dry_run: true,
    } as GscHealthInput)
    expect(args).toContain('--dry-run')
  })
})

describe('parseHealthOutput', () => {
  it('parses a valid envelope', () => {
    const stdout = JSON.stringify({
      command: 'gsc_health',
      site: 'sc-domain:example.com',
      generated_at: '2026-06-05T12:00:00Z',
      results: [
        {
          url: 'https://example.com/a',
          change: 'regression',
          changes: [
            { field: 'coverage_state', before: 'Submitted and indexed', after: "Excluded by 'noindex' tag" },
          ],
          current_state: {
            coverage_state: "Excluded by 'noindex' tag",
            google_canonical: '',
            user_canonical: '',
            robots_blocked: false,
            indexing_allowed: false,
            mobile_usable: true,
            rich_results_status: '',
          },
        },
      ],
      quota_used: 1,
    })
    const out = parseHealthOutput(stdout)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].change).toBe('regression')
    expect(out.results[0].changes?.[0].field).toBe('coverage_state')
  })

  it('throws on wrong command', () => {
    expect(() =>
      parseHealthOutput(
        JSON.stringify({ command: 'other', site: 's', generated_at: 'g', results: [], quota_used: 0 }),
      ),
    ).toThrow(/Unexpected command/)
  })

  it('throws on garbled stdout', () => {
    expect(() => parseHealthOutput('not json')).toThrow()
  })
})

describe('gscHealthTool definition', () => {
  it('has the registered name', () => {
    expect(gscHealthTool.name).toBe('gsc_health')
  })

  it('mentions noindex in the description so callers know the use case', () => {
    expect(gscHealthTool.description.toLowerCase()).toContain('noindex')
  })

  it('marks config as required', () => {
    expect(gscHealthTool.inputSchema.required).toContain('config')
  })
})
