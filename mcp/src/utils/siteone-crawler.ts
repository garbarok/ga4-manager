// ============================================================================
// siteone-crawler.ts — URL discovery through the SiteOne Crawler binary
// https://github.com/janreges/siteone-crawler
//
// Verified from the SiteOne README / docs/JSON-OUTPUT.md: flags `--url`,
// `--max-visited-urls`, `--output=json`, `--output-json-file=<file>`; JSON has
// `results[]` ({url, status (string), type (1 = HTML)}) and `tables.redirects`
// ({statusCode, url, targetUrl}) / `tables.404` ({statusCode, url}).
//
// Not documented, so assumed and parsed defensively: whether tables are plain
// arrays or wrapped ({rows|items|data}), whether 3xx rows appear in results[],
// and what the binary prints to stdout (we always read the JSON file).
// ============================================================================

import { execFile } from 'node:child_process'
import { access, constants, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ToolError, ErrorCode } from './errors.js'

export const SITEONE_REPO_URL = 'https://github.com/janreges/siteone-crawler'
const BINARY_NAME = 'siteone-crawler'
const DEFAULT_CRAWL_TIMEOUT_MS = 90 * 1000

/** SITEONE_CRAWL_TIMEOUT_MS (`|| undefined`: unset arrives as "" in the .mcpb bundle), else 90 s. */
function crawlTimeoutMs(): number {
  const n = Number.parseInt(process.env.SITEONE_CRAWL_TIMEOUT_MS || '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CRAWL_TIMEOUT_MS
}
const HTML_TYPE = 1

export interface CrawlerRunOptions {
  timeoutMs: number
  /** Working dir for the child; keeps anything it writes to ./tmp inside the cleaned-up temp dir. */
  cwd?: string
}

/** Spawns the crawler. Injected in tests so the real binary never runs. */
export type CrawlerRunner = (
  binary: string,
  args: string[],
  opts: CrawlerRunOptions,
) => Promise<{ exitCode: number; stderr: string }>

export interface SiteOneDeps {
  runner?: CrawlerRunner
  /** Resolves the binary path, or null when it is not installed. */
  resolveBinary?: () => Promise<string | null>
}

export interface DiscoveredRedirect {
  url: string
  target_url: string
  status: number
}

export interface DiscoveredBrokenLink {
  url: string
  status: number
}

export interface SiteOneDiscovery {
  html_urls: string[]
  broken_links: DiscoveredBrokenLink[]
  redirects: DiscoveredRedirect[]
}

export const defaultRunner: CrawlerRunner = (binary, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: opts.timeoutMs, killSignal: 'SIGKILL', cwd: opts.cwd, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) return resolve({ exitCode: 0, stderr })
        if ((error as { killed?: boolean }).killed) {
          return reject(
            new Error(`crawl timed out after ${Math.round(opts.timeoutMs / 1000)}s; lower max_urls`),
          )
        }
        const code = (error as { code?: unknown }).code
        if (typeof code === 'number') return resolve({ exitCode: code, stderr })
        reject(error)
      },
    )
  })

/** SITEONE_CRAWLER_PATH first (`|| undefined`: unset arrives as "" in the .mcpb bundle), then PATH. */
export async function resolveSiteOneBinary(): Promise<string | null> {
  const explicit = process.env.SITEONE_CRAWLER_PATH || undefined
  if (explicit) {
    return (await isExecutable(explicit)) ? explicit : null
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, BINARY_NAME)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function siteOneMissingError(): ToolError {
  return new ToolError(
    ErrorCode.NOT_FOUND,
    `${BINARY_NAME} binary not found on PATH (and SITEONE_CRAWLER_PATH is unset or not executable)`,
    `Install SiteOne Crawler (${SITEONE_REPO_URL}; Homebrew: brew install janreges/tap/siteone-crawler) or set SITEONE_CRAWLER_PATH to the binary.`,
  )
}

export function buildCrawlerArgs(startUrl: string, maxUrls: number, jsonFile: string): string[] {
  return [
    `--url=${startUrl}`,
    `--max-visited-urls=${maxUrls}`,
    '--output=json',
    `--output-json-file=${jsonFile}`,
    // Live data only: the default 24h HTTP cache would serve stale statuses after a fix.
    '--no-cache',
    // An empty value disables each report, so nothing is left behind on disk.
    '--output-html-report=',
    '--output-text-file=',
  ]
}

export async function discoverWithSiteOne(
  startUrl: string,
  maxUrls: number,
  deps: SiteOneDeps = {},
): Promise<SiteOneDiscovery> {
  const binary = await (deps.resolveBinary ?? resolveSiteOneBinary)()
  if (!binary) throw siteOneMissingError()

  const dir = await mkdtemp(join(tmpdir(), 'siteone-'))
  const jsonFile = join(dir, 'output.json')
  try {
    const run = deps.runner ?? defaultRunner
    let result: { exitCode: number; stderr: string }
    try {
      result = await run(binary, buildCrawlerArgs(startUrl, maxUrls, jsonFile), { timeoutMs: crawlTimeoutMs(), cwd: dir })
    } catch (err) {
      throw new ToolError(
        ErrorCode.UPSTREAM_5XX,
        `${BINARY_NAME} failed to run: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let raw: string
    try {
      raw = await readFile(jsonFile, 'utf8')
    } catch {
      throw new ToolError(
        ErrorCode.UPSTREAM_5XX,
        `${BINARY_NAME} exited with code ${result.exitCode} and wrote no JSON report`,
        result.stderr.trim().slice(-500) || undefined,
      )
    }
    // Exit code 10 is SiteOne's CI quality gate, not a crawl failure; a readable report is what matters.
    return parseSiteOneReport(raw)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asRows(table: unknown): Record<string, unknown>[] {
  if (Array.isArray(table)) return table.filter(isRecord)
  if (isRecord(table)) {
    for (const key of ['rows', 'items', 'data']) {
      if (Array.isArray(table[key])) return (table[key] as unknown[]).filter(isRecord)
    }
  }
  return []
}

function toStatus(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : 0
}

function isHtmlType(v: unknown): boolean {
  return v === HTML_TYPE || (typeof v === 'string' && /^(1|html)$/i.test(v))
}

/** Defensive parse of the SiteOne JSON report (see header for what is assumed). */
export function parseSiteOneReport(raw: string): SiteOneDiscovery {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ToolError(ErrorCode.UPSTREAM_5XX, `${BINARY_NAME} produced an unreadable JSON report`)
  }
  if (!isRecord(json)) {
    throw new ToolError(ErrorCode.UPSTREAM_5XX, `${BINARY_NAME} JSON report has an unexpected shape`)
  }

  const html = new Set<string>()
  const broken = new Map<string, DiscoveredBrokenLink>()
  const redirects = new Map<string, DiscoveredRedirect>()

  for (const row of asRows(json.results)) {
    if (typeof row.url !== 'string') continue
    const status = toStatus(row.status)
    if (status === 200 && isHtmlType(row.type)) html.add(row.url)
    else if (status >= 400) broken.set(row.url, { url: row.url, status })
  }

  const tables = isRecord(json.tables) ? json.tables : {}
  for (const row of asRows(tables['404'])) {
    if (typeof row.url !== 'string') continue
    broken.set(row.url, { url: row.url, status: toStatus(row.statusCode) || 404 })
  }
  for (const row of asRows(tables.redirects)) {
    if (typeof row.url !== 'string' || typeof row.targetUrl !== 'string') continue
    redirects.set(row.url, { url: row.url, target_url: row.targetUrl, status: toStatus(row.statusCode) })
  }

  return { html_urls: [...html], broken_links: [...broken.values()], redirects: [...redirects.values()] }
}
