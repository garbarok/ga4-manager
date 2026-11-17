import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync, accessSync, constants } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { ToolError, ErrorCode } from './errors.js'

/**
 * Project-local JSON state for native tools (ADR-0005, extended by ADR-0006).
 *
 * Every file carries the same envelope as the Go store in internal/gsc/state,
 * so one directory can hold both:
 *   { schema_version, command, site, generated_at, data }
 *
 * Two layouts:
 *   - snapshot:   <dir>/<command>.<site>.json          (one file per command × site)
 *   - collection: <dir>/<collection>/<site>/<id>.json  (many records per site:
 *                 audits, reports, cache entries, tracker runs)
 *
 * Writes are atomic (temp file + rename in the same directory). Readers reject
 * an unknown schema_version with an "upgrade or delete" error, as the Go
 * loader does. There is no locking: one tool call is the single writer of a
 * given file, and the last rename wins.
 */

export const STATE_SCHEMA_VERSION = 1
export const DEFAULT_STATE_DIRNAME = '.ga4-state'

export interface StateEnvelope<T> {
  schema_version: number
  command: string
  site: string
  generated_at: string
  data: T
}

/**
 * The directory state lives in, in priority order:
 *   1. an explicit `state_dir` tool input / --state-dir flag;
 *   2. GA4M_STATE_DIR;
 *   3. `.ga4-state/` next to the site config, when a config path is given;
 *   4. `.ga4-state/` in the working directory, when it is writable and not `/`
 *      (Claude Desktop starts servers in `/`);
 *   5. `~/.ga4-state/`.
 */
export function resolveStateDir(opts: { stateDir?: string; config?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  if (opts.stateDir?.trim()) return absolute(opts.stateDir.trim(), cwd)
  if (env.GA4M_STATE_DIR?.trim()) return absolute(env.GA4M_STATE_DIR.trim(), cwd)
  if (opts.config?.trim()) return join(dirname(absolute(opts.config.trim(), cwd)), DEFAULT_STATE_DIRNAME)
  if (cwd !== '/' && isWritable(cwd)) return join(cwd, DEFAULT_STATE_DIRNAME)
  return join(homedir(), DEFAULT_STATE_DIRNAME)
}

function absolute(p: string, cwd: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p)
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The per-site key used in file names: a lowercase host without scheme,
 * `www.`, port or path. `sc-domain:Example.com`, `https://www.example.com/x`
 * and `example.com` all map to `example.com`.
 */
export function siteKey(site: string): string {
  const key = site
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(key)) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `"${site}" is not a usable site: pass a domain such as example.com, a URL, or sc-domain:example.com.`)
  }
  return key
}

/** File-name-safe id: letters, digits, dash, underscore and dot only. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || id.startsWith('.')) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `Invalid id "${id}": use letters, digits, "-", "_" or "." (max 128).`)
  }
  return id
}

/** A sortable, unique id: 20260917T120000Z-a1b2c3. */
export function newId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

export class StateStore {
  constructor(public readonly dir: string) {}

  snapshotPath(command: string, site: string): string {
    return join(this.dir, `${safeId(command)}.${siteKey(site)}.json`)
  }

  collectionDir(collection: string, site: string): string {
    return join(this.dir, safeId(collection), siteKey(site))
  }

  recordPath(collection: string, site: string, id: string): string {
    return join(this.collectionDir(collection, site), `${safeId(id)}.json`)
  }

  readSnapshot<T>(command: string, site: string): StateEnvelope<T> | null {
    return readEnvelope<T>(this.snapshotPath(command, site))
  }

  writeSnapshot<T>(command: string, site: string, data: T, now: Date = new Date()): StateEnvelope<T> {
    const env = envelope(command, siteKey(site), data, now)
    atomicWriteJson(this.snapshotPath(command, site), env)
    return env
  }

  readRecord<T>(collection: string, site: string, id: string): StateEnvelope<T> | null {
    return readEnvelope<T>(this.recordPath(collection, site, id))
  }

  writeRecord<T>(collection: string, site: string, id: string, data: T, now: Date = new Date()): StateEnvelope<T> {
    const env = envelope(collection, siteKey(site), data, now)
    atomicWriteJson(this.recordPath(collection, site, id), env)
    return env
  }

  deleteRecord(collection: string, site: string, id: string): boolean {
    const path = this.recordPath(collection, site, id)
    try {
      statSync(path)
    } catch {
      return false
    }
    rmSync(path, { force: true })
    return true
  }

  /** Record ids in a collection, newest first (ids from newId() sort by time). */
  listRecordIds(collection: string, site: string): string[] {
    let names: string[]
    try {
      names = readdirSync(this.collectionDir(collection, site))
    } catch {
      return []
    }
    return names
      .filter((n) => n.endsWith('.json') && !n.includes('.tmp-'))
      .map((n) => n.slice(0, -'.json'.length))
      .sort()
      .reverse()
  }

  /** Sites that have at least one record in a collection. */
  listSites(collection: string): string[] {
    try {
      return readdirSync(join(this.dir, safeId(collection))).sort()
    } catch {
      return []
    }
  }
}

function envelope<T>(command: string, site: string, data: T, now: Date): StateEnvelope<T> {
  return { schema_version: STATE_SCHEMA_VERSION, command, site, generated_at: now.toISOString(), data }
}

export function readEnvelope<T>(path: string): StateEnvelope<T> | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ToolError(ErrorCode.UPSTREAM_5XX, `Cannot read state file ${path}: ${(err as Error).message}`)
  }
  let parsed: StateEnvelope<T>
  try {
    parsed = JSON.parse(raw) as StateEnvelope<T>
  } catch {
    throw new ToolError(ErrorCode.INVALID_INPUT, `State file ${path} is not valid JSON.`, 'Delete it to rebaseline.')
  }
  if (parsed.schema_version !== STATE_SCHEMA_VERSION) {
    throw new ToolError(
      ErrorCode.INVALID_INPUT,
      `State file ${path} has schema_version ${String(parsed.schema_version)}; this build reads ${STATE_SCHEMA_VERSION}.`,
      'Upgrade ga4-manager, or delete the file and rebaseline (ADR-0005).',
    )
  }
  return parsed
}

export function atomicWriteJson(path: string, value: unknown): void {
  const dir = dirname(path)
  try {
    mkdirSync(dir, { recursive: true })
    const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, path)
  } catch (err) {
    throw new ToolError(
      ErrorCode.INVALID_INPUT,
      `Cannot write state under ${dir}: ${(err as Error).message}`,
      'Pass state_dir (CLI: --state-dir) or set GA4M_STATE_DIR to a writable directory.',
    )
  }
}
