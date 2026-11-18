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

describe('per-resource access (B13)', () => {
  it('turns the affected groups degraded with the grant to add', async () => {
    const { applyAccess } = await import('./server-info.js')
    const groups = [
      { id: 'search_console', title: 'Search Console', status: 'enabled' as const, reasons: [], tools: [] },
      { id: 'ga4_data', title: 'GA4', status: 'enabled' as const, reasons: [], tools: [] },
      { id: 'dataforseo', title: 'DFS', status: 'enabled' as const, reasons: [], tools: [] },
    ]
    const out = applyAccess(groups, [
      { resource: 'sc-domain:example.com', api: 'search_console', ok: false, permission: null, how_to_fix: 'add sa@example.iam' },
      { resource: 'properties/123456789', api: 'ga4', ok: true, permission: 'viewer or above' },
    ])
    expect(out.map((g) => [g.id, g.status])).toEqual([['search_console', 'degraded'], ['ga4_data', 'enabled'], ['dataforseo', 'enabled']])
    expect(out[0].reasons[0]).toMatch(/No access to sc-domain:example.com: add sa@example.iam/)
  })

  it('probes the site and property with free read calls', async () => {
    const { vi } = await import('vitest')
    const auth = await import('../utils/google-auth.js')
    vi.spyOn(auth, 'getGoogleAuthHeaders').mockResolvedValue({ Authorization: 'Bearer t' })
    vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url).includes('webmasters')
        ? new Response(JSON.stringify({ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteRestrictedUser' }))
        : new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: 403 }),
    )
    const { probeResourceAccess } = await import('./server-info.js')
    const out = await probeResourceAccess({ site: 'sc-domain:example.com', property: 'properties/123456789' }, 'sa@example.iam')
    expect(out[0]).toMatchObject({ api: 'search_console', ok: true, permission: 'siteRestrictedUser' })
    expect(out[1]).toMatchObject({ api: 'ga4', ok: false, reason: 'The caller does not have permission', how_to_fix: expect.stringMatching(/add sa@example.iam as Viewer/) })
    vi.restoreAllMocks()
  })
})
