import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decorate, dispatchTool } from './dispatch.js'
import { contextFromArgs, type ToolContext } from './utils/tool-context.js'
import { StateStore } from './utils/state-store.js'
import { loadContext } from './utils/project-context-store.js'
import { CLIExecutor } from './cli/executor.js'

function ctx(dir: string, site: string | null, lookups: ToolContext['lookups']): ToolContext {
  return { tool: 'keyword_volume', site, stateDir: dir, refresh: false, lookups }
}

describe('contextFromArgs', () => {
  it('takes the site from site, domain, target or domains[0], and the state dir from config', () => {
    expect(contextFromArgs('t', { site: 'sc-domain:example.com' }, {}).site).toBe('example.com')
    expect(contextFromArgs('t', { domain: 'https://www.example.org/x' }, {}).site).toBe('example.org')
    expect(contextFromArgs('t', { domains: ['example.net', 'b.com'] }, {}).site).toBe('example.net')
    expect(contextFromArgs('t', { keywords: ['x'] }, { GA4M_DEFAULT_SITE: 'default.com' }).site).toBe('default.com')
    expect(contextFromArgs('t', { config: '/srv/configs/a.yaml' }, {}).stateDir).toBe('/srv/configs/.ga4-state')
    expect(contextFromArgs('t', { refresh_cache: true }, {}).refresh).toBe(true)
  })
})

describe('decorate', () => {
  it('leaves output untouched when no paid lookup happened', () => {
    const out = { success: true }
    expect(decorate(out, ctx('/nonexistent', 'example.com', []))).toBe(out)
  })

  it('appends billed lookups to the research log and reports cache hits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-dispatch-'))
    const out = decorate(
      { success: true },
      ctx(dir, 'example.com', [
        { path: 'serp/google/organic/live/advanced', params: { keyword: 'a' }, cost_usd: 0.002, from_cache: false },
        { path: 'serp/google/organic/live/advanced', params: { keyword: 'b' }, cost_usd: 0, from_cache: true, cached_at: '2026-01-01T00:00:00.000Z' },
      ]),
      new Date('2026-01-02T00:00:00Z'),
    ) as Record<string, unknown>
    expect(out.research_log).toEqual({ site: 'example.com', appended: 1 })
    expect(out.cache).toMatchObject({ hits: 1, misses: 1, cached_at: ['2026-01-01T00:00:00.000Z'] })
    const log = loadContext(new StateStore(dir), 'example.com').research_log
    expect(log).toEqual([
      { at: '2026-01-02T00:00:00.000Z', tool: 'keyword_volume', endpoint: 'serp/google/organic/live/advanced', params: { keyword: 'a' }, cost_usd: 0.002 },
    ])
  })

  it('says why nothing was logged when the input names no site', () => {
    const out = decorate({ success: true }, ctx('/tmp', null, [{ path: 'p', params: {}, cost_usd: 0.1, from_cache: false }])) as Record<string, unknown>
    expect(out.research_log).toMatchObject({ site: null, appended: 0 })
  })
})

describe('dispatchTool', () => {
  const executor = new CLIExecutor('/nonexistent/ga4')

  it('reports unknown tools and invalid input as errors', async () => {
    expect(await dispatchTool('nope', {}, executor)).toMatchObject({ isError: true, output: { error: 'Unknown tool: nope' } })
    const bad = await dispatchTool('keyword_volume', { keywords: 'not-an-array' }, executor)
    expect(bad.isError).toBe(true)
  })

  it('applies the write gate', async () => {
    const out = await dispatchTool('ga4_setup', { config: 'x.yaml' }, executor, { GA4M_READ_ONLY: '1' })
    expect(out).toMatchObject({ isError: true, output: { success: false, error: { code: 'INVALID_INPUT' } } })
  })
})
