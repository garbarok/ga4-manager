import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOperations, summarizeResearch, missingParts } from './project-context.js'
import { emptyContext } from '../utils/project-context-store.js'
import { dispatchTool } from '../dispatch.js'
import { CLIExecutor } from '../cli/executor.js'

const executor = new CLIExecutor('/nonexistent/ga4')
const NOW = new Date('2026-03-01T00:00:00Z')

describe('applyOperations', () => {
  it('adds, upserts and removes each target', () => {
    const { context, applied } = applyOperations(
      emptyContext('example.com'),
      [
        { op: 'add', target: 'brand_name', text: 'Example' },
        { op: 'upsert', target: 'section', name: 'current_goal', text: 'Grow organic signups' },
        { op: 'add', target: 'section', name: 'audience_notes', text: 'SMB owners' },
        { op: 'add', target: 'competitor', domain: 'https://www.Rival.example/x', label: 'Rival' },
        { op: 'upsert', target: 'competitor', domain: 'rival.example', notes: 'strong on guides' },
        { op: 'add', target: 'key_page', url: 'https://example.com/pricing#plans', role: 'money', topic: 'pricing' },
        { op: 'upsert', target: 'key_page', url: 'https://example.com/pricing', role: 'hub' },
        { op: 'remove', target: 'section', name: 'audience_notes' },
        { op: 'add', target: 'research_log', endpoint: 'manual check', params: { q: 'x' } },
      ],
      NOW,
    )
    expect(applied).toHaveLength(9)
    expect(context.brand_name).toBe('Example')
    expect(context.sections).toEqual({ current_goal: 'Grow organic signups' })
    expect(context.competitors).toEqual([{ domain: 'rival.example', name: 'Rival', notes: 'strong on guides' }])
    expect(context.key_pages).toEqual([{ url: 'https://example.com/pricing', role: 'hub', topic: 'pricing' }])
    expect(context.research_log[0]).toMatchObject({ tool: 'manual', endpoint: 'manual check', at: NOW.toISOString() })
  })

  it('is all or nothing and names the failing operation', () => {
    const base = emptyContext('example.com')
    expect(() =>
      applyOperations(base, [
        { op: 'add', target: 'competitor', domain: 'a.example' },
        { op: 'add', target: 'competitor', domain: 'a.example' },
      ]),
    ).toThrow(/operations\[1\].*already listed/)
    expect(base.competitors).toEqual([])
    expect(() => applyOperations(base, [{ op: 'add', target: 'key_page', url: '/relative' }])).toThrow(/absolute/)
    expect(() => applyOperations(base, [{ op: 'upsert', target: 'section', name: 'Bad Name', text: 'x' }])).toThrow(/lowercase/)
    expect(() => applyOperations(base, [{ op: 'remove', target: 'research_log' }])).toThrow(/before is required/)
  })

  it('prunes the research log before a date', () => {
    const ctx = { ...emptyContext('example.com'), research_log: [
      { at: '2026-01-01T00:00:00Z', tool: 't', endpoint: 'e', params: {}, cost_usd: 0.1 },
      { at: '2026-02-15T00:00:00Z', tool: 't', endpoint: 'e', params: {}, cost_usd: 0.1 },
    ] }
    expect(applyOperations(ctx, [{ op: 'remove', target: 'research_log', before: '2026-02-01' }]).context.research_log).toHaveLength(1)
  })
})

describe('summaries', () => {
  it('de-duplicates lookups and totals cost', () => {
    const s = summarizeResearch([
      { at: '2026-01-01T00:00:00Z', tool: 't', endpoint: 'serp', params: { keyword: 'a' }, cost_usd: 0.002 },
      { at: '2026-01-05T00:00:00Z', tool: 't', endpoint: 'serp', params: { keyword: 'a' }, cost_usd: 0.002 },
      { at: '2026-01-03T00:00:00Z', tool: 't', endpoint: 'labs', params: {}, cost_usd: null },
    ])
    expect(s.total_cost_usd).toBe(0.004)
    expect(s.recent_lookups[0]).toEqual({ endpoint: 'serp', params: { keyword: 'a' }, last_at: '2026-01-05T00:00:00Z', times: 2 })
  })
  it('lists what is missing', () => {
    expect(missingParts(emptyContext('example.com'))).toContain('sections.business_overview')
  })
})

describe('through the dispatcher', () => {
  it('update then get round-trips under state_dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-ctx-'))
    const upd = await dispatchTool('project_context_update', {
      site: 'sc-domain:example.com',
      state_dir: dir,
      operations: [{ op: 'upsert', target: 'brand_name', text: 'Example' }],
    }, executor)
    expect(upd.isError).toBe(false)
    const got = await dispatchTool('project_context_get', { site: 'example.com', state_dir: dir }, executor)
    expect(got.output).toMatchObject({ success: true, exists: true, site: 'example.com', context: { brand_name: 'Example' } })
    expect((got.output as { state_file: string }).state_file).toBe(join(dir, 'project-context.example.com.json'))
  })

  it('dry_run does not save, and a missing site is INVALID_INPUT', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-ctx-'))
    await dispatchTool('project_context_update', { site: 'example.com', state_dir: dir, dry_run: true, operations: [{ op: 'upsert', target: 'brand_name', text: 'X' }] }, executor)
    const got = await dispatchTool('project_context_get', { site: 'example.com', state_dir: dir }, executor)
    expect(got.output).toMatchObject({ exists: false })
    const bad = await dispatchTool('project_context_get', { state_dir: dir }, executor)
    expect(bad.output).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })
})
