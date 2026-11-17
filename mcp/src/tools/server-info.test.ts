import { describe, it, expect } from 'vitest'
import { evaluateGroups, runServerInfo } from './server-info.js'
import { GROUPS, GROUP_BY_TOOL } from '../tool-groups.js'
import { SPECS } from '../registry.js'
import { CLIExecutor } from '../cli/executor.js'

const REG = [
  { name: 'server_info', kind: 'native' as const, destructive: false, readOnly: true },
  { name: 'keyword_volume', kind: 'native' as const, destructive: false, readOnly: true },
  { name: 'gsc_analytics_run', kind: 'cli' as const, destructive: false, readOnly: true },
  { name: 'ga4_setup', kind: 'cli' as const, destructive: true, readOnly: false },
  { name: 'dataforseo_request', kind: 'native' as const, destructive: false, readOnly: true },
]

describe('evaluateGroups', () => {
  it('explains a disabled DataForSEO group and a missing ga4 binary', async () => {
    const groups = await evaluateGroups(REG, { env: {}, binaryUsable: false })
    const dfs = groups.find((g) => g.id === 'dataforseo')!
    expect(dfs.status).toBe('disabled')
    expect(dfs.reasons[0]).toMatch(/Missing DATAFORSEO_USERNAME, DATAFORSEO_PASSWORD/)
    const gsc = groups.find((g) => g.id === 'search_console')!
    expect(gsc.status).toBe('disabled')
    expect(gsc.reasons[0]).toMatch(/GOOGLE_APPLICATION_CREDENTIALS is not set/)
    expect(groups.find((g) => g.id === 'raw_escape_hatch')!.reasons.join(' ')).toMatch(/DATAFORSEO_ALLOW_RAW/)
  })

  it('marks CLI tools unavailable without the binary and destructive tools without the opt-in', async () => {
    const env = { DATAFORSEO_USERNAME: 'u', DATAFORSEO_PASSWORD: 'p', GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent.json' }
    const groups = await evaluateGroups(REG, { env, binaryUsable: false })
    expect(groups.find((g) => g.id === 'dataforseo')!.status).toBe('enabled')
    // An unreadable credentials file blocks Google groups with the read error.
    expect(groups.find((g) => g.id === 'ga4_admin')!.reasons[0]).toMatch(/cannot be read/)
  })

  it('reports a failed scope probe as the blocking reason', async () => {
    const env = { GOOGLE_APPLICATION_CREDENTIALS: new URL('../../package.json', import.meta.url).pathname }
    // package.json is readable JSON but not a credential → unsupported type
    const groups = await evaluateGroups(REG, { env, binaryUsable: true, probe: async () => 'scope missing' })
    expect(groups.find((g) => g.id === 'search_console')!.reasons[0]).toMatch(/not supported/)
  })
})

describe('server_info', () => {
  it('every registered tool belongs to a group, and groups name only real tools', () => {
    const names = new Set(SPECS.map((s) => s.tool.name))
    for (const n of names) expect(GROUP_BY_TOOL.has(n), `${n} has no group`).toBe(true)
    const listed = GROUPS.flatMap((g) => g.tools)
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('reports version, tool count and an update hint', async () => {
    const out = await runServerInfo({ probe_scopes: false }, new CLIExecutor('/nonexistent/ga4'), {})
    expect(out.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(out.tool_count).toBe(SPECS.length)
    expect(out.ga4_cli.path_usable).toBe(false)
    expect(out.update_hint).toMatch(/INSTALL\.md/)
  })
})
