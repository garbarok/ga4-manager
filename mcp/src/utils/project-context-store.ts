import { StateStore, siteKey } from './state-store.js'
import type { PaidLookup } from './tool-context.js'

/**
 * Per-site project context: shared memory between agents and sessions
 * (OpenSEO get/update_project_context). Stored as the snapshot
 * `project-context.<site>.json` in the state dir next to the site config.
 */

export const PROJECT_CONTEXT_COMMAND = 'project-context'
export const STANDARD_SECTIONS = ['business_overview', 'current_goal', 'positioning', 'writing_preferences'] as const
export const KEY_PAGE_ROLES = ['hub', 'spoke', 'money', 'other'] as const
export const RESEARCH_LOG_LIMIT = 500

export type KeyPageRole = (typeof KEY_PAGE_ROLES)[number]

export interface Competitor {
  domain: string
  name?: string
  notes?: string
}

export interface KeyPage {
  url: string
  role: KeyPageRole
  topic?: string
}

export interface ResearchLogEntry {
  at: string
  tool: string
  endpoint: string
  params: Record<string, unknown>
  cost_usd: number | null
  note?: string
}

export interface ProjectContext {
  site: string
  brand_name: string | null
  /** Prose sections: the four standard ones plus any custom name. */
  sections: Record<string, string>
  competitors: Competitor[]
  key_pages: KeyPage[]
  research_log: ResearchLogEntry[]
  updated_at: string | null
}

export function emptyContext(site: string): ProjectContext {
  return { site: siteKey(site), brand_name: null, sections: {}, competitors: [], key_pages: [], research_log: [], updated_at: null }
}

export function loadContext(store: StateStore, site: string): ProjectContext {
  const snap = store.readSnapshot<ProjectContext>(PROJECT_CONTEXT_COMMAND, site)
  if (!snap) return emptyContext(site)
  const data = snap.data
  return {
    ...emptyContext(site),
    ...data,
    sections: data.sections ?? {},
    competitors: data.competitors ?? [],
    key_pages: data.key_pages ?? [],
    research_log: data.research_log ?? [],
  }
}

export function saveContext(store: StateStore, ctx: ProjectContext, now: Date = new Date()): ProjectContext {
  const next = { ...ctx, updated_at: now.toISOString() }
  store.writeSnapshot(PROJECT_CONTEXT_COMMAND, ctx.site, next, now)
  return next
}

/** Billed lookups only: a cached result cost nothing and is already on record. */
export function researchEntries(tool: string, lookups: PaidLookup[], now: Date = new Date()): ResearchLogEntry[] {
  return lookups
    .filter((l) => !l.from_cache)
    .map((l) => ({ at: now.toISOString(), tool, endpoint: l.path, params: l.params, cost_usd: l.cost_usd, ...(l.note ? { note: l.note } : {}) }))
}

export function appendResearch(ctx: ProjectContext, entries: ResearchLogEntry[]): ProjectContext {
  const log = [...ctx.research_log, ...entries]
  return { ...ctx, research_log: log.slice(Math.max(0, log.length - RESEARCH_LOG_LIMIT)) }
}

/**
 * Append a tool call's billed lookups to the site's research log. Never
 * throws: logging must not fail a lookup that was already paid for.
 */
export function logResearch(stateDir: string, site: string, tool: string, lookups: PaidLookup[], now: Date = new Date()): number {
  const entries = researchEntries(tool, lookups, now)
  if (entries.length === 0) return 0
  try {
    const store = new StateStore(stateDir)
    saveContext(store, appendResearch(loadContext(store, site), entries), now)
    return entries.length
  } catch {
    return 0
  }
}
