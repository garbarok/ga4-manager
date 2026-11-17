import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveStateDir, siteKey } from './state-store.js'

/**
 * Per-call context shared by the dispatcher and the paid-API clients.
 *
 * The dispatcher (src/dispatch.ts) opens one context per tool call. Deep in
 * the call, dataforseoRequest reads it to find the site's lookup cache and to
 * record every billed request; when the tool returns, the dispatcher reads it
 * back to tell the caller what came from cache and to append the paid lookups
 * to the site's research log. Tools never pass any of this explicitly, so the
 * cache and the research log cover every DataForSEO tool, old and new.
 */

export interface PaidLookup {
  path: string
  /** Short, human-readable parameters (keyword, target, location...). */
  params: Record<string, unknown>
  cost_usd: number | null
  from_cache: boolean
  cached_at?: string
}

export interface ToolContext {
  tool: string
  /** Normalized site key (example.com) when the input names one, else null. */
  site: string | null
  stateDir: string
  /** Skip reading the lookup cache (results are still written to it). */
  refresh: boolean
  lookups: PaidLookup[]
}

const storage = new AsyncLocalStorage<ToolContext>()

export function currentContext(): ToolContext | undefined {
  return storage.getStore()
}

export function runWithContext<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

/** Tools that resolve a site late (e.g. from a config) set it here so the cache and log use it. */
export function setContextSite(site: string): void {
  const ctx = storage.getStore()
  if (!ctx) return
  try {
    ctx.site = siteKey(site)
  } catch {
    // An unusable site leaves the context unscoped.
  }
}

/**
 * Which input field names the site, in priority order. `site` wins; then the
 * target of a competitive lookup (`domain`, `target`); `domains[0]` covers
 * keyword_gap-style tools.
 */
const SITE_FIELDS = ['site', 'domain', 'target', 'url', 'start_url'] as const

export function contextFromArgs(tool: string, args: unknown, env: NodeJS.ProcessEnv = process.env): ToolContext {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  let site: string | null = null
  for (const field of SITE_FIELDS) {
    const v = a[field]
    if (typeof v === 'string' && v.trim()) {
      try {
        site = siteKey(v)
        break
      } catch {
        // keep looking
      }
    }
  }
  if (!site && Array.isArray(a.domains) && typeof a.domains[0] === 'string') {
    try {
      site = siteKey(a.domains[0])
    } catch {
      site = null
    }
  }
  if (!site && env.GA4M_DEFAULT_SITE?.trim()) {
    try {
      site = siteKey(env.GA4M_DEFAULT_SITE)
    } catch {
      site = null
    }
  }
  return {
    tool,
    site,
    stateDir: resolveStateDir({
      stateDir: typeof a.state_dir === 'string' ? a.state_dir : undefined,
      config: typeof a.config === 'string' ? a.config : undefined,
      env,
    }),
    refresh: a.refresh_cache === true,
    lookups: [],
  }
}
