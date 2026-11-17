import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { GROUPS, GROUP_BY_TOOL, type GroupDef, type Requirement } from '../tool-groups.js'
import { readServerVersion } from '../binary.js'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import { readSpendLimits } from '../utils/spend-guard.js'
import { resolveStateDir } from '../utils/state-store.js'
import { cacheEnabled } from '../utils/lookup-cache.js'

// ============================================================================
// Input Schema
// ============================================================================

export const serverInfoInputSchema = z.object({
  probe_scopes: z
    .boolean()
    .optional()
    .default(false)
    .describe('Also mint a Google token per scope and check the scope was granted (network call, free). Default false.'),
})

export type ServerInfoInput = z.infer<typeof serverInfoInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export type GroupStatus = 'enabled' | 'degraded' | 'disabled'

export interface GroupReport {
  id: string
  title: string
  status: GroupStatus
  /** Why the group is disabled or degraded; empty when fully enabled. */
  reasons: string[]
  tools: { name: string; available: boolean; reason?: string }[]
}

export interface ServerInfoResult {
  success: true
  name: 'ga4-manager'
  version: string
  ga4_cli: { path_usable: boolean; version: string | null; note?: string }
  node: string
  tool_count: number
  groups: GroupReport[]
  credentials: { google: string; type: string | null }
  state_dir: string
  lookup_cache: 'on' | 'off'
  spending_caps: ReturnType<typeof readSpendLimits>
  write_mode: { read_only: boolean; destructive_allowed: boolean }
  update_hint: string
}

// ============================================================================
// Handler
// ============================================================================

function isOn(v: string | undefined): boolean {
  const s = v?.trim().toLowerCase()
  return s === '1' || s === 'true'
}

function credentialType(env: NodeJS.ProcessEnv): { summary: string; type: string | null; problem: string | null } {
  const path = env.GOOGLE_APPLICATION_CREDENTIALS
  if (!path) return { summary: 'not set', type: null, problem: 'GOOGLE_APPLICATION_CREDENTIALS is not set.' }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { type?: string }
    const type = parsed.type ?? 'unknown'
    if (type !== 'service_account' && type !== 'authorized_user') {
      return { summary: `unsupported type ${type}`, type, problem: `Credentials type "${type}" is not supported (service_account or authorized_user).` }
    }
    return { summary: 'readable', type, problem: null }
  } catch (err) {
    return { summary: 'unreadable', type: null, problem: `GOOGLE_APPLICATION_CREDENTIALS cannot be read: ${(err as Error).message}` }
  }
}

async function scopeGranted(scope: string): Promise<string | null> {
  try {
    const headers = await getGoogleAuthHeaders([scope])
    const token = headers.Authorization.replace(/^Bearer /, '')
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
    if (!res.ok) return `Token check failed (HTTP ${res.status}).`
    const info = (await res.json()) as { scope?: string }
    const granted = (info.scope ?? '').split(' ')
    // analytics.edit implies readonly; webmasters implies webmasters.readonly.
    const implied = scope.endsWith('.readonly') ? scope.replace(/\.readonly$/, '') : null
    if (granted.includes(scope) || (implied && granted.includes(implied))) return null
    if (scope.endsWith('analytics.readonly') && granted.some((g) => g.endsWith('/analytics.edit'))) return null
    return `The credential was not granted ${scope}. Re-run gcloud auth application-default login with that scope (mcp/PERMISSIONS.md).`
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export async function evaluateGroups(
  registered: { name: string; kind: 'cli' | 'native'; destructive: boolean; readOnly: boolean }[],
  opts: { env: NodeJS.ProcessEnv; binaryUsable: boolean; probe?: (scope: string) => Promise<string | null> },
): Promise<GroupReport[]> {
  const { env } = opts
  const cred = credentialType(env)
  const probeCache = new Map<string, Promise<string | null>>()
  const byName = new Map(registered.map((r) => [r.name, r]))

  async function reasonsFor(req: Requirement): Promise<{ blocking: string[]; degrading: string[] }> {
    switch (req.kind) {
      case 'google': {
        if (cred.problem) return { blocking: [cred.problem], degrading: [] }
        if (!opts.probe) return { blocking: [], degrading: [] }
        if (!probeCache.has(req.scope)) probeCache.set(req.scope, opts.probe(req.scope))
        const problem = await probeCache.get(req.scope)!
        return { blocking: problem ? [problem] : [], degrading: [] }
      }
      case 'env': {
        const missing = req.vars.filter((v) => !env[v]?.trim())
        return { blocking: missing.length ? [`Missing ${missing.join(', ')}. ${req.hint}`] : [], degrading: [] }
      }
      case 'optional_env': {
        const missing = req.vars.filter((v) => !env[v]?.trim())
        return { blocking: [], degrading: missing.length ? [`${missing.join(', ')} not set: ${req.effect}`] : [] }
      }
      case 'flag':
        return { blocking: isOn(env[req.var]) ? [] : [req.hint], degrading: [] }
    }
  }

  const reports: GroupReport[] = []
  for (const group of GROUPS as GroupDef[]) {
    const blocking: string[] = []
    const degrading: string[] = []
    for (const req of group.requirements) {
      const r = await reasonsFor(req)
      blocking.push(...r.blocking)
      degrading.push(...r.degrading)
    }
    const tools = group.tools
      .filter((t) => byName.has(t))
      .map((name) => {
        const t = byName.get(name)!
        let reason: string | undefined
        if (blocking.length) reason = blocking[0]
        else if (t.kind === 'cli' && !opts.binaryUsable) reason = 'Needs the ga4 CLI binary (not found). Install it or set GA4_BINARY_PATH (INSTALL.md).'
        else if (isOn(env.GA4M_READ_ONLY) && !t.readOnly) reason = 'Write tool refused: GA4M_READ_ONLY is on.'
        else if (t.destructive && !isOn(env.GA4M_ALLOW_DESTRUCTIVE)) reason = 'Destructive tool: set GA4M_ALLOW_DESTRUCTIVE=1 to enable.'
        return reason ? { name, available: false, reason } : { name, available: true }
      })
    if (tools.length === 0) continue
    const anyOff = tools.some((t) => !t.available)
    const status: GroupStatus = blocking.length ? 'disabled' : anyOff || degrading.length ? 'degraded' : 'enabled'
    const toolReasons = [...new Set(tools.filter((t) => !t.available && t.reason && !blocking.includes(t.reason)).map((t) => t.reason!))]
    reports.push({ id: group.id, title: group.title, status, reasons: [...blocking, ...degrading, ...toolReasons], tools })
  }
  return reports
}

async function ga4CliVersion(executor: CLIExecutor): Promise<string | null> {
  if (!executor.isBinaryUsable()) return null
  try {
    const r = await executor.execute({ command: '--version', args: [], timeout: 5000 })
    const m = (r.stdout + r.stderr).match(/version\s+(\S+)/)
    return m ? m[1] : r.stdout.trim() || null
  } catch {
    return null
  }
}

export async function runServerInfo(input: ServerInfoInput, executor: CLIExecutor, env: NodeJS.ProcessEnv = process.env): Promise<ServerInfoResult> {
  // Lazy import: the registry imports this module.
  const { SPECS } = await import('../registry.js')
  const registered = SPECS.map((s) => ({
    name: s.tool.name,
    kind: s.kind,
    destructive: s.tool.annotations?.destructiveHint === true,
    readOnly: s.tool.annotations?.readOnlyHint === true,
  }))
  const ungrouped = registered.filter((r) => !GROUP_BY_TOOL.has(r.name)).map((r) => r.name)
  const binaryUsable = executor.isBinaryUsable()
  const groups = await evaluateGroups(registered, { env, binaryUsable, probe: input.probe_scopes ? scopeGranted : undefined })
  if (ungrouped.length) {
    groups.push({ id: 'other', title: 'Other', status: 'enabled', reasons: [], tools: ungrouped.map((name) => ({ name, available: true })) })
  }
  const cliVersion = await ga4CliVersion(executor)
  const cred = credentialType(env)
  const version = readServerVersion()
  return {
    success: true,
    name: 'ga4-manager',
    version,
    ga4_cli: {
      path_usable: binaryUsable,
      version: cliVersion,
      ...(binaryUsable ? {} : { note: 'CLI-backed tools (GA4 admin, most gsc_*) are unavailable until the ga4 binary is installed.' }),
    },
    node: process.version,
    tool_count: registered.length,
    groups,
    credentials: { google: cred.summary, type: cred.type },
    state_dir: resolveStateDir({ env }),
    lookup_cache: cacheEnabled(env) ? 'on' : 'off',
    spending_caps: readSpendLimits(env),
    write_mode: { read_only: isOn(env.GA4M_READ_ONLY), destructive_allowed: isOn(env.GA4M_ALLOW_DESTRUCTIVE) },
    update_hint:
      `This server is ga4-manager-mcp ${version}. If tools you expect are missing, the client runs an older install: ` +
      'Claude Desktop → reinstall the latest .mcpb from GitHub Releases; npx → use "ga4-manager-mcp@latest" in the client config and restart; ' +
      'global npm → npm i -g ga4-manager-mcp@latest. Details: INSTALL.md "Updating".',
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const serverInfoTool = {
  name: 'server_info',
  description:
    'Use first when a tool seems missing or fails with a credentials error, or to see what this install can do. ' +
    'Returns the server version, the ga4 CLI version, every tool group (GA4 admin, GA4 data, Search Console, AdSense, audits, DataForSEO, ValueSERP, local state) ' +
    'with status enabled/degraded/disabled and the reason (e.g. missing DATAFORSEO_USERNAME, no ga4 binary, read-only mode), the state directory, ' +
    'lookup-cache status, spending caps and how to update an outdated install. Free; no API calls unless probe_scopes is true. Also answers "whoami".',
  inputSchema: {
    type: 'object',
    properties: {
      probe_scopes: {
        type: 'boolean',
        description: 'Also mint a Google token per scope and check it was granted (free network call). Default false.',
        default: false,
      },
    },
  },
  annotations: { title: 'Server info and enabled tool groups', readOnlyHint: true, openWorldHint: false },
}

export const serverInfoSpec = native({
  tool: serverInfoTool,
  schema: serverInfoInputSchema,
  run: async (input, executor) => ({ output: await runServerInfo(input, executor), isError: false }),
})
