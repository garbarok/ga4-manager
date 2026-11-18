import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readEnvelope, atomicWriteJson, STATE_SCHEMA_VERSION, type StateEnvelope } from './state-store.js'

/**
 * On-disk cache of DataForSEO responses, per site and request parameters.
 *
 * Repeating a paid lookup inside its TTL returns the stored result at no cost,
 * as OpenSEO does within a project. TTLs follow how fast the data moves:
 *   - AI answers (LLM responses, LLM scraper, LLM mentions, Google AI Mode): 7 days
 *   - live SERPs (rank checks, SERP snapshots, AI Overviews):               6 hours
 *   - everything else (Labs, keyword data, backlinks, trends):             24 hours
 * GA4M_CACHE=off disables it; GA4M_CACHE_TTL_HOURS overrides every TTL.
 *
 * Files: <state_dir>/cache/<site or _unscoped>/<sha256>.json, in the shared
 * state envelope. Entries past their TTL are ignored and overwritten.
 */

const HOUR_MS = 3_600_000

export interface CacheEntry {
  path: string
  task: Record<string, unknown> | null
  items: unknown[]
  /** What DataForSEO billed when the entry was stored. */
  cost_usd: number | null
  cached_at: string
  expires_at: string
}

export function cacheTtlMs(path: string, env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.GA4M_CACHE_TTL_HOURS)
  if (env.GA4M_CACHE_TTL_HOURS && Number.isFinite(override) && override >= 0) return override * HOUR_MS
  if (/^ai_optimization\//.test(path) || /^serp\/google\/ai_mode\//.test(path)) return 7 * 24 * HOUR_MS
  if (/^serp\//.test(path)) return 6 * HOUR_MS
  return 24 * HOUR_MS
}

export function cacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GA4M_CACHE ?? '').trim().toLowerCase() !== 'off'
}

/** Stable JSON: object keys sorted at every depth, so key order never changes the hash. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function cacheKey(method: string, path: string, task: Record<string, unknown> | undefined): string {
  return createHash('sha256')
    .update(stableStringify({ method, path, task: task ?? null }))
    .digest('hex')
}

function entryPath(stateDir: string, site: string | null, key: string): string {
  return join(stateDir, 'cache', site ?? '_unscoped', `${key}.json`)
}

export function readCache(
  stateDir: string,
  site: string | null,
  key: string,
  now: number = Date.now(),
): CacheEntry | null {
  let env: StateEnvelope<CacheEntry> | null
  try {
    env = readEnvelope<CacheEntry>(entryPath(stateDir, site, key))
  } catch {
    return null // a corrupt or old entry is a miss, never an error
  }
  if (!env) return null
  if (Date.parse(env.data.expires_at) <= now) return null
  return env.data
}

export function writeCache(
  stateDir: string,
  site: string | null,
  key: string,
  entry: Omit<CacheEntry, 'cached_at' | 'expires_at'>,
  ttlMs: number,
  now: number = Date.now(),
): void {
  if (ttlMs <= 0) return
  const data: CacheEntry = {
    ...entry,
    cached_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  }
  const envelope: StateEnvelope<CacheEntry> = {
    schema_version: STATE_SCHEMA_VERSION,
    command: 'cache',
    site: site ?? '_unscoped',
    generated_at: data.cached_at,
    data,
  }
  try {
    atomicWriteJson(entryPath(stateDir, site, key), envelope)
  } catch {
    // A read-only state dir must not fail a lookup that was already paid for.
  }
}
