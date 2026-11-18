import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { StateStore, siteKey } from '../utils/state-store.js'
import { currentContext, setContextSite } from '../utils/tool-context.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import { normalizeDomain } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import {
  loadContext,
  saveContext,
  KEY_PAGE_ROLES,
  STANDARD_SECTIONS,
  type ProjectContext,
  type ResearchLogEntry,
} from '../utils/project-context-store.js'

/**
 * project_context_get / project_context_update: per-site shared memory for
 * agents (OpenSEO get/update_project_context). Brand, prose sections,
 * competitors, key pages and a dated research log of paid lookups. Paid tools
 * append to the log automatically (src/dispatch.ts); agents read it before
 * buying the same data again.
 */

// ============================================================================
// Shared site resolution
// ============================================================================

const siteFields = {
  site: z.string().optional().describe('Site: example.com, a URL, or sc-domain:example.com'),
  config: z.string().optional().describe('Path to the site YAML config; its search_console.site_url names the site and state is stored next to it'),
  state_dir: z.string().optional().describe('Override the state directory (default: .ga4-state next to the config)'),
}

const siteSchemaProps = {
  site: { type: 'string', description: 'Site: example.com, a URL, or sc-domain:example.com' },
  config: { type: 'string', description: 'Path to the site YAML config (alternative to site; state is stored next to it)' },
  state_dir: { type: 'string', description: 'Override the state directory (default .ga4-state next to the config)' },
}

/** The site key for a tool input: `site` wins, else the config's GSC site. */
export async function resolveSite(input: { site?: string; config?: string }, executor: CLIExecutor): Promise<string> {
  if (input.site) return siteKey(input.site)
  if (input.config) {
    const [cfg] = await resolveConfigs(executor, { config: input.config })
    if (!cfg?.gsc_site) {
      throw new ToolError(ErrorCode.INVALID_INPUT, `Config ${input.config} has no search_console.site_url.`, 'Pass `site` instead.')
    }
    setContextSite(cfg.gsc_site)
    return siteKey(cfg.gsc_site)
  }
  throw new ToolError(ErrorCode.INVALID_INPUT, 'Pass `site` (e.g. example.com) or `config`.')
}

export function storeFor(): StateStore {
  const ctx = currentContext()
  if (!ctx) throw new ToolError(ErrorCode.INVALID_INPUT, 'No tool context: call through the dispatcher.')
  return new StateStore(ctx.stateDir)
}

// ============================================================================
// project_context_get
// ============================================================================

export const projectContextGetInputSchema = z.object({
  ...siteFields,
  research_limit: z.number().int().min(0).max(500).optional().default(50).describe('Newest research-log entries to return (default 50)'),
  research_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Only research-log entries on or after this date (YYYY-MM-DD)'),
})

export type ProjectContextGetInput = z.infer<typeof projectContextGetInputSchema>

export interface ResearchSummary {
  entries: number
  total_cost_usd: number
  /** Distinct (endpoint, params) lookups already bought, newest first, so agents can skip them. */
  recent_lookups: { endpoint: string; params: Record<string, unknown>; last_at: string; times: number }[]
}

export type ProjectContextGetResult =
  | {
      success: true
      site: string
      state_file: string
      exists: boolean
      context: Omit<ProjectContext, 'research_log'> & { research_log: ResearchLogEntry[] }
      research: ResearchSummary
      missing: string[]
    }
  | ToolFailureResult

export function summarizeResearch(log: ResearchLogEntry[]): ResearchSummary {
  const byKey = new Map<string, { endpoint: string; params: Record<string, unknown>; last_at: string; times: number }>()
  for (const e of log) {
    const key = `${e.endpoint} ${JSON.stringify(e.params)}`
    const prev = byKey.get(key)
    if (prev) {
      prev.times += 1
      if (e.at > prev.last_at) prev.last_at = e.at
    } else byKey.set(key, { endpoint: e.endpoint, params: e.params, last_at: e.at, times: 1 })
  }
  const total = log.reduce((a, e) => a + (e.cost_usd ?? 0), 0)
  return {
    entries: log.length,
    total_cost_usd: Math.round(total * 1e6) / 1e6,
    recent_lookups: [...byKey.values()].sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, 30),
  }
}

/** What an agent should fill in before relying on the context. */
export function missingParts(ctx: ProjectContext): string[] {
  const missing: string[] = []
  if (!ctx.brand_name) missing.push('brand_name')
  for (const s of STANDARD_SECTIONS) if (!ctx.sections[s]?.trim()) missing.push(`sections.${s}`)
  if (ctx.competitors.length === 0) missing.push('competitors')
  if (ctx.key_pages.length === 0) missing.push('key_pages')
  return missing
}

export async function runProjectContextGet(input: ProjectContextGetInput, executor: CLIExecutor): Promise<ProjectContextGetResult> {
  try {
    const site = await resolveSite(input, executor)
    const store = storeFor()
    const exists = store.readSnapshot(PROJECT_CONTEXT_FILE_COMMAND, site) !== null
    const ctx = loadContext(store, site)
    const filtered = input.research_since ? ctx.research_log.filter((e) => e.at.slice(0, 10) >= input.research_since!) : ctx.research_log
    return {
      success: true,
      site,
      state_file: store.snapshotPath(PROJECT_CONTEXT_FILE_COMMAND, site),
      exists,
      context: { ...ctx, research_log: input.research_limit === 0 ? [] : filtered.slice(-input.research_limit).reverse() },
      research: summarizeResearch(filtered),
      missing: missingParts(ctx),
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

const PROJECT_CONTEXT_FILE_COMMAND = 'project-context'

export const projectContextGetTool = {
  name: 'project_context_get',
  description:
    'Use at the start of any SEO task for a site, and before buying DataForSEO data: returns the site\'s shared project context — brand name, prose sections ' +
    '(business_overview, current_goal, positioning, writing_preferences, custom), competitors, key pages (hub/spoke/money/other) and the research log of paid lookups ' +
    'already bought (with a de-duplicated `research.recent_lookups`), plus `missing` (what is not filled in yet). Free, local file. ' +
    'Fill gaps with project_context_update.',
  inputSchema: {
    type: 'object',
    properties: {
      ...siteSchemaProps,
      research_limit: { type: 'number', description: 'Newest research-log entries to return (default 50, 0 = none)', default: 50 },
      research_since: { type: 'string', description: 'Only research-log entries on or after this date (YYYY-MM-DD)' },
    },
  },
  annotations: { title: 'Read project context', readOnlyHint: true, openWorldHint: false },
}

export const projectContextGetSpec = native({
  tool: projectContextGetTool,
  schema: projectContextGetInputSchema,
  run: async (input, executor) => {
    const output = await runProjectContextGet(input, executor)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// project_context_update
// ============================================================================

const TARGETS = ['brand_name', 'section', 'competitor', 'key_page', 'research_log'] as const

export const contextOperationSchema = z.object({
  op: z.enum(['add', 'upsert', 'remove']).describe('add (fails if it exists), upsert (insert or merge), remove'),
  target: z.enum(TARGETS),
  name: z.string().optional().describe('section: section name (business_overview, current_goal, positioning, writing_preferences or a custom name)'),
  text: z.string().optional().describe('section: prose; brand_name: the brand'),
  domain: z.string().optional().describe('competitor: domain'),
  label: z.string().optional().describe('competitor: display name'),
  notes: z.string().optional().describe('competitor: notes'),
  url: z.string().optional().describe('key_page: URL'),
  role: z.enum(KEY_PAGE_ROLES).optional().describe('key_page: hub, spoke, money or other'),
  topic: z.string().optional().describe('key_page: topic'),
  endpoint: z.string().optional().describe('research_log add: what was looked up'),
  params: z.record(z.string(), z.unknown()).optional().describe('research_log add: parameters'),
  cost_usd: z.number().optional().describe('research_log add: cost'),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('research_log remove: drop entries before this date'),
})

export type ContextOperation = z.infer<typeof contextOperationSchema>

export const projectContextUpdateInputSchema = z.object({
  ...siteFields,
  operations: z.array(contextOperationSchema).min(1).max(100),
  dry_run: z.boolean().optional().default(false).describe('Validate and return the result without saving'),
})

export type ProjectContextUpdateInput = z.infer<typeof projectContextUpdateInputSchema>

function need<T>(value: T | undefined, what: string, i: number): T {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `operations[${i}]: ${what} is required.`)
  }
  return value
}

function normalizePageUrl(url: string, i: number): string {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme')
    u.hash = ''
    return u.toString()
  } catch {
    throw new ToolError(ErrorCode.INVALID_INPUT, `operations[${i}]: "${url}" is not an absolute http(s) URL.`)
  }
}

/**
 * Apply operations in order to a copy of the context. All or nothing: the
 * first invalid operation throws and nothing is saved.
 */
export function applyOperations(ctx: ProjectContext, ops: ContextOperation[], now: Date = new Date()): { context: ProjectContext; applied: string[] } {
  const next: ProjectContext = {
    ...ctx,
    sections: { ...ctx.sections },
    competitors: ctx.competitors.map((c) => ({ ...c })),
    key_pages: ctx.key_pages.map((p) => ({ ...p })),
    research_log: [...ctx.research_log],
  }
  const applied: string[] = []
  ops.forEach((op, i) => {
    const fail = (msg: string): never => {
      throw new ToolError(ErrorCode.INVALID_INPUT, `operations[${i}]: ${msg}`)
    }
    switch (op.target) {
      case 'brand_name': {
        if (op.op === 'remove') next.brand_name = null
        else {
          if (op.op === 'add' && next.brand_name) fail('brand_name is already set; use upsert to change it.')
          next.brand_name = need(op.text, 'text', i).trim()
        }
        applied.push(`${op.op} brand_name`)
        break
      }
      case 'section': {
        const name = need(op.name, 'name', i).trim()
        if (!/^[a-z0-9_]{1,64}$/.test(name)) fail(`section name "${name}" must be lowercase letters, digits or _.`)
        if (op.op === 'remove') {
          if (!(name in next.sections)) fail(`section "${name}" does not exist.`)
          delete next.sections[name]
        } else {
          if (op.op === 'add' && next.sections[name]) fail(`section "${name}" exists; use upsert to replace it.`)
          next.sections[name] = need(op.text, 'text', i).trim()
        }
        applied.push(`${op.op} section ${name}`)
        break
      }
      case 'competitor': {
        const domain = normalizeDomain(need(op.domain, 'domain', i))
        if (!domain.includes('.')) fail(`"${op.domain}" is not a domain.`)
        const idx = next.competitors.findIndex((c) => c.domain === domain)
        if (op.op === 'remove') {
          if (idx < 0) fail(`competitor ${domain} is not listed.`)
          next.competitors.splice(idx, 1)
        } else if (idx >= 0) {
          if (op.op === 'add') fail(`competitor ${domain} is already listed; use upsert.`)
          const c = next.competitors[idx]
          if (op.label !== undefined) c.name = op.label
          if (op.notes !== undefined) c.notes = op.notes
        } else {
          next.competitors.push({ domain, ...(op.label ? { name: op.label } : {}), ...(op.notes ? { notes: op.notes } : {}) })
        }
        applied.push(`${op.op} competitor ${domain}`)
        break
      }
      case 'key_page': {
        const url = normalizePageUrl(need(op.url, 'url', i), i)
        const idx = next.key_pages.findIndex((p) => p.url === url)
        if (op.op === 'remove') {
          if (idx < 0) fail(`key page ${url} is not listed.`)
          next.key_pages.splice(idx, 1)
        } else if (idx >= 0) {
          if (op.op === 'add') fail(`key page ${url} is already listed; use upsert.`)
          const p = next.key_pages[idx]
          if (op.role) p.role = op.role
          if (op.topic !== undefined) p.topic = op.topic
        } else {
          next.key_pages.push({ url, role: op.role ?? 'other', ...(op.topic ? { topic: op.topic } : {}) })
        }
        applied.push(`${op.op} key_page ${url}`)
        break
      }
      case 'research_log': {
        if (op.op === 'remove') {
          const before = need(op.before, 'before', i)
          const kept = next.research_log.filter((e) => e.at.slice(0, 10) >= before)
          applied.push(`remove ${next.research_log.length - kept.length} research_log entries before ${before}`)
          next.research_log = kept
        } else {
          next.research_log.push({
            at: now.toISOString(),
            tool: 'manual',
            endpoint: need(op.endpoint, 'endpoint', i),
            params: op.params ?? {},
            cost_usd: op.cost_usd ?? null,
          })
          applied.push('add research_log entry')
        }
        break
      }
    }
  })
  return { context: next, applied }
}

export type ProjectContextUpdateResult =
  | { success: true; site: string; dry_run: boolean; applied: string[]; context: ProjectContext; missing: string[] }
  | ToolFailureResult

export async function runProjectContextUpdate(input: ProjectContextUpdateInput, executor: CLIExecutor): Promise<ProjectContextUpdateResult> {
  try {
    const site = await resolveSite(input, executor)
    const store = storeFor()
    const { context, applied } = applyOperations(loadContext(store, site), input.operations)
    const saved = input.dry_run ? context : saveContext(store, context)
    return { success: true, site, dry_run: input.dry_run, applied, context: saved, missing: missingParts(saved) }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

export const projectContextUpdateTool = {
  name: 'project_context_update',
  description:
    'Use to record what you learn about a site so the next agent starts from it: brand name, prose sections (business_overview, current_goal, positioning, ' +
    'writing_preferences or custom), competitors (domain, label, notes), key pages (url, role hub/spoke/money/other, topic), or a manual research-log entry. ' +
    'Takes a list of patch operations {op: add|upsert|remove, target: brand_name|section|competitor|key_page|research_log, ...fields}, applied in order, all or nothing. ' +
    'Paid tools already append their lookups to the research log on their own. Free, local file next to the site config.',
  inputSchema: {
    type: 'object',
    required: ['operations'],
    properties: {
      ...siteSchemaProps,
      operations: {
        type: 'array',
        description:
          'Patch operations. Examples: {"op":"upsert","target":"section","name":"current_goal","text":"..."}, ' +
          '{"op":"add","target":"competitor","domain":"rival.example","label":"Rival"}, ' +
          '{"op":"upsert","target":"key_page","url":"https://example.com/pricing","role":"money","topic":"pricing"}, ' +
          '{"op":"remove","target":"research_log","before":"2026-01-01"}',
        items: {
          type: 'object',
          required: ['op', 'target'],
          properties: {
            op: { type: 'string', enum: ['add', 'upsert', 'remove'] },
            target: { type: 'string', enum: [...TARGETS] },
            name: { type: 'string', description: 'section name' },
            text: { type: 'string', description: 'section prose or brand name' },
            domain: { type: 'string', description: 'competitor domain' },
            label: { type: 'string', description: 'competitor display name' },
            notes: { type: 'string', description: 'competitor notes' },
            url: { type: 'string', description: 'key page URL' },
            role: { type: 'string', enum: [...KEY_PAGE_ROLES] },
            topic: { type: 'string', description: 'key page topic' },
            endpoint: { type: 'string', description: 'research_log add: what was looked up' },
            params: { type: 'object', description: 'research_log add: parameters' },
            cost_usd: { type: 'number', description: 'research_log add: cost' },
            before: { type: 'string', description: 'research_log remove: drop entries before YYYY-MM-DD' },
          },
        },
      },
      dry_run: { type: 'boolean', description: 'Validate and return the result without saving (default false)', default: false },
    },
  },
  annotations: { title: 'Update project context', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}

export const projectContextUpdateSpec = native({
  tool: projectContextUpdateTool,
  schema: projectContextUpdateInputSchema,
  run: async (input, executor) => {
    const output = await runProjectContextUpdate(input, executor)
    return { output, isError: !output.success }
  },
})
