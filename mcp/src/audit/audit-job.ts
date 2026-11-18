import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { StateStore } from '../utils/state-store.js'
import { renderHtml } from '../utils/cloudflare-render.js'
import { readServerVersion } from '../binary.js'
import { crawlSite, httpFetcher, type CrawlResult, type CrawledPage, type Fetcher } from './crawler.js'
import { analyzeSite, summarize, DEFAULT_THRESHOLDS, type AuditSummary, type IssueThresholds, type SiteIssue } from './site-issues.js'
import { pickRepresentativePages, runLighthouse, psiFetcher, type LighthouseRun, type PsiFetcher, type Strategy } from './lighthouse.js'

/**
 * A site audit as a background job. The tool call writes a `queued` record
 * and starts a detached `ga4m __site-audit-worker` process. That process is the
 * only writer of the record while it runs: it updates progress, then stores
 * pages, issues and (optionally) Lighthouse results. Status tools only read.
 *
 * Records: <state_dir>/site-audits/<site>/<id>.json (small: status, issues)
 *          <state_dir>/site-audit-pages/<site>/<id>.json (every crawled page)
 */

export const AUDITS = 'site-audits'
export const AUDIT_PAGES = 'site-audit-pages'
export const STALL_MS = 3 * 60_000

export type AuditStatus = 'queued' | 'running' | 'lighthouse' | 'done' | 'failed' | 'cancelled'

export interface AuditOptions {
  start_url: string
  max_pages: number
  max_duration_s: number
  concurrency: number
  delay_ms: number
  exclude_paths: string[]
  include_sitemap: boolean
  render_js: boolean
  lighthouse: boolean
  lighthouse_pages: number
  lighthouse_strategies: Strategy[]
  thresholds: IssueThresholds
}

export interface LighthouseState {
  status: 'not_requested' | 'pending' | 'running' | 'done' | 'failed'
  pages: string[]
  strategies: Strategy[]
  runs: LighthouseRun[]
  error?: string
}

export interface AuditRecord {
  id: string
  site: string
  status: AuditStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  pid: number | null
  options: AuditOptions
  progress: { pages_crawled: number; queued: number; current_url: string | null; rate_limited_hits: number; updated_at: string }
  crawl: Omit<CrawlResult, 'pages'> | null
  summary: AuditSummary | null
  issues: SiteIssue[] | null
  lighthouse: LighthouseState
  error?: string
}

export function newRecord(id: string, site: string, options: AuditOptions, now: Date = new Date()): AuditRecord {
  return {
    id,
    site,
    status: 'queued',
    created_at: now.toISOString(),
    started_at: null,
    finished_at: null,
    pid: null,
    options,
    progress: { pages_crawled: 0, queued: 0, current_url: null, rate_limited_hits: 0, updated_at: now.toISOString() },
    crawl: null,
    summary: null,
    issues: null,
    lighthouse: { status: options.lighthouse ? 'pending' : 'not_requested', pages: [], strategies: options.lighthouse_strategies, runs: [] },
  }
}

export function readAudit(store: StateStore, site: string, id: string): AuditRecord | null {
  return store.readRecord<AuditRecord>(AUDITS, site, id)?.data ?? null
}

export function writeAudit(store: StateStore, rec: AuditRecord): void {
  store.writeRecord(AUDITS, rec.site, rec.id, rec)
}

export function readPages(store: StateStore, site: string, id: string): CrawledPage[] | null {
  return store.readRecord<CrawledPage[]>(AUDIT_PAGES, site, id)?.data ?? null
}

function pidAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A running job whose worker is gone or silent is reported as stalled, not as running forever. */
export function effectiveStatus(rec: AuditRecord, now: number = Date.now()): AuditStatus | 'stalled' {
  if (rec.status !== 'running' && rec.status !== 'lighthouse' && rec.status !== 'queued') return rec.status
  const quiet = now - Date.parse(rec.progress.updated_at) > STALL_MS
  if (rec.pid && !pidAlive(rec.pid)) return 'stalled'
  if (quiet && rec.status !== 'queued') return 'stalled'
  if (rec.status === 'queued' && now - Date.parse(rec.created_at) > STALL_MS) return 'stalled'
  return rec.status
}

export interface JobDeps {
  fetch?: Fetcher
  psi?: PsiFetcher
  render?: (url: string) => Promise<string>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

export function auditUserAgent(): string {
  return `ga4-manager-audit/${readServerVersion()} (+https://github.com/garbarok/ga4-manager)`
}

/** Run (or resume the Lighthouse phase of) an audit in this process. */
export async function runAuditJob(stateDir: string, site: string, id: string, deps: JobDeps = {}): Promise<AuditRecord> {
  const store = new StateStore(stateDir)
  const now = deps.now ?? (() => new Date())
  const rec = readAudit(store, site, id)
  if (!rec) throw new Error(`Audit ${id} not found for ${site} in ${stateDir}`)
  rec.pid = process.pid
  const o = rec.options

  try {
    if (rec.status === 'queued') {
      rec.status = 'running'
      rec.started_at = now().toISOString()
      rec.progress.updated_at = rec.started_at
      writeAudit(store, rec)

      let lastWrite = 0
      const crawl = await crawlSite(
        {
          startUrl: o.start_url,
          maxPages: o.max_pages,
          maxDurationMs: o.max_duration_s * 1000,
          concurrency: o.concurrency,
          delayMs: o.delay_ms,
          excludePaths: o.exclude_paths,
          includeSitemap: o.include_sitemap,
          renderJs: o.render_js,
          userAgent: auditUserAgent(),
        },
        {
          fetch: deps.fetch ?? httpFetcher,
          sleep: deps.sleep,
          render: o.render_js ? (deps.render ?? ((u: string) => renderHtml(u))) : undefined,
          onProgress: (p) => {
            rec.progress = { ...p, updated_at: now().toISOString() }
            if (Date.now() - lastWrite > 2000) {
              lastWrite = Date.now()
              writeAudit(store, rec)
            }
          },
        },
      )
      const { pages, ...meta } = crawl
      const issues = analyzeSite(crawl, o.thresholds)
      store.writeRecord(AUDIT_PAGES, site, id, pages)
      rec.crawl = meta
      rec.issues = issues
      rec.summary = summarize(crawl, issues)
      rec.progress = { ...rec.progress, pages_crawled: pages.length, queued: 0, current_url: null, updated_at: now().toISOString() }
      if (o.lighthouse) rec.lighthouse.pages = pickRepresentativePages(pages, crawl.final_start_url, o.lighthouse_pages)
    }

    if (rec.lighthouse.status === 'pending' || rec.status === 'lighthouse') {
      rec.status = 'lighthouse'
      rec.lighthouse.status = 'running'
      if (rec.lighthouse.pages.length === 0) {
        const pages = readPages(store, site, id) ?? []
        rec.lighthouse.pages = pickRepresentativePages(pages, rec.crawl?.final_start_url ?? o.start_url, o.lighthouse_pages)
      }
      rec.progress.updated_at = now().toISOString()
      writeAudit(store, rec)
      rec.lighthouse.runs = await runLighthouse(rec.lighthouse.pages, rec.lighthouse.strategies, deps.psi ?? psiFetcher, {
        onDone: () => {
          rec.progress.updated_at = now().toISOString()
          writeAudit(store, rec)
        },
      })
      const failed = rec.lighthouse.runs.filter((r) => r.error)
      rec.lighthouse.status = failed.length === rec.lighthouse.runs.length && failed.length > 0 ? 'failed' : 'done'
      if (rec.lighthouse.status === 'failed') rec.lighthouse.error = failed[0].error
    }

    rec.status = 'done'
    rec.finished_at = now().toISOString()
    rec.pid = null
    writeAudit(store, rec)
    return rec
  } catch (err) {
    rec.status = 'failed'
    rec.error = err instanceof Error ? err.message : String(err)
    rec.finished_at = now().toISOString()
    rec.pid = null
    writeAudit(store, rec)
    return rec
  }
}

/** Start the worker as a detached process that outlives this tool call. */
export function launchWorker(stateDir: string, site: string, id: string): number | null {
  const here = fileURLToPath(import.meta.url)
  const isTs = here.endsWith('.ts')
  const cliPath = join(dirname(here), '..', isTs ? 'cli.ts' : 'cli.js')
  const child = spawn(process.execPath, [...(isTs ? process.execArgv : []), cliPath, '__site-audit-worker', stateDir, site, id], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
  return child.pid ?? null
}

export const DEFAULT_AUDIT_OPTIONS: Omit<AuditOptions, 'start_url'> = {
  max_pages: 200,
  max_duration_s: 900,
  concurrency: 4,
  delay_ms: 250,
  exclude_paths: [],
  include_sitemap: true,
  render_js: false,
  lighthouse: false,
  lighthouse_pages: 5,
  lighthouse_strategies: ['mobile', 'desktop'],
  thresholds: DEFAULT_THRESHOLDS,
}
