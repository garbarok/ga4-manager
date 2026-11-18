import { z } from 'zod'
import { native } from '../tool-spec.js'
import { StateStore, newId, siteKey, safeId } from '../utils/state-store.js'
import { currentContext } from '../utils/tool-context.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import {
  AUDITS,
  AUDIT_PAGES,
  DEFAULT_AUDIT_OPTIONS,
  effectiveStatus,
  launchWorker,
  newRecord,
  readAudit,
  readPages,
  runAuditJob,
  writeAudit,
  type AuditOptions,
  type AuditRecord,
  type JobDeps,
} from '../audit/audit-job.js'
import { DEFAULT_THRESHOLDS, type Severity } from '../audit/site-issues.js'
import type { CrawledPage, StatusKind } from '../audit/crawler.js'
import type { Strategy } from '../audit/lighthouse.js'

/**
 * Site crawl audit tools (OpenSEO run_site_audit / get_audit_status /
 * get_audit_issues / get_audit_pages / get_audit_lighthouse / list / delete).
 * The crawl itself lives in src/audit/; these tools start it in the
 * background and read its stored record.
 */

type Fail = ToolFailureResult

function store(): StateStore {
  const ctx = currentContext()
  if (!ctx) throw new ToolError(ErrorCode.INVALID_INPUT, 'No tool context: call through the dispatcher.')
  return new StateStore(ctx.stateDir)
}

function fail(err: unknown): Fail {
  if (err instanceof ToolError) return toolErrorToFailure(err)
  return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
}

/** The audit to read: the given id, or the newest one for the site. */
function pickAudit(s: StateStore, site: string, auditId?: string): AuditRecord {
  const id = auditId ? safeId(auditId) : s.listRecordIds(AUDITS, site)[0]
  if (!id) throw new ToolError(ErrorCode.NOT_FOUND, `No site audits stored for ${site}.`, 'Start one with site_audit_run.')
  const rec = readAudit(s, site, id)
  if (!rec) throw new ToolError(ErrorCode.NOT_FOUND, `Audit ${id} not found for ${site}.`, 'List audits with site_audit_list.')
  return rec
}

const siteProps = {
  site: { type: 'string', description: 'Site: example.com, a URL or sc-domain:example.com' },
  audit_id: { type: 'string', description: 'Audit id (default: the newest audit for the site)' },
  state_dir: { type: 'string', description: 'Override the state directory (default .ga4-state)' },
}
const siteFields = {
  site: z.string().min(1),
  audit_id: z.string().optional(),
  state_dir: z.string().optional(),
}

// ============================================================================
// site_audit_run
// ============================================================================

export const siteAuditRunInputSchema = z.object({
  start_url: z.string().url().describe('Absolute URL to start from, e.g. https://example.com/'),
  site: z.string().optional().describe('Site key for storage (default: the start URL host)'),
  state_dir: z.string().optional(),
  max_pages: z.number().int().min(1).max(10_000).optional().default(DEFAULT_AUDIT_OPTIONS.max_pages),
  max_duration_s: z.number().int().min(10).max(6 * 3600).optional().default(DEFAULT_AUDIT_OPTIONS.max_duration_s),
  concurrency: z.number().int().min(1).max(8).optional().default(DEFAULT_AUDIT_OPTIONS.concurrency),
  delay_ms: z.number().int().min(0).max(10_000).optional().default(DEFAULT_AUDIT_OPTIONS.delay_ms),
  exclude_paths: z.array(z.string().min(1)).max(100).optional().default([]),
  include_sitemap: z.boolean().optional().default(true),
  render_js: z.boolean().optional().default(false),
  lighthouse: z.boolean().optional().default(false),
  lighthouse_pages: z.number().int().min(1).max(10).optional().default(DEFAULT_AUDIT_OPTIONS.lighthouse_pages),
  lighthouse_strategies: z.array(z.enum(['mobile', 'desktop'])).min(1).optional().default(['mobile', 'desktop']),
  thresholds: z
    .object({
      thin_words: z.number().int().min(0).optional(),
      slow_ms: z.number().int().min(1).optional(),
      deep_depth: z.number().int().min(1).optional(),
    })
    .optional()
    .default({}),
  background: z.boolean().optional().default(true).describe('Run in a detached process and return at once (default). false waits for the result.'),
})

export type SiteAuditRunInput = z.infer<typeof siteAuditRunInputSchema>

export async function runSiteAuditRun(
  input: SiteAuditRunInput,
  launcher: typeof launchWorker = launchWorker,
  deps: JobDeps = {},
): Promise<Record<string, unknown> | Fail> {
  try {
    const site = siteKey(input.site ?? input.start_url)
    const s = store()
    const running = s
      .listRecordIds(AUDITS, site)
      .slice(0, 5)
      .map((id) => readAudit(s, site, id))
      .find((r) => r && ['queued', 'running', 'lighthouse'].includes(effectiveStatus(r)))
    if (running) {
      return errorResult(
        ErrorCode.INVALID_INPUT,
        `Audit ${running.id} for ${site} is still ${running.status}.`,
        'Poll it with site_audit_status, or delete it with site_audit_delete before starting another.',
      )
    }
    const options: AuditOptions = {
      start_url: input.start_url,
      max_pages: input.max_pages,
      max_duration_s: input.max_duration_s,
      concurrency: input.concurrency,
      delay_ms: input.delay_ms,
      exclude_paths: input.exclude_paths,
      include_sitemap: input.include_sitemap,
      render_js: input.render_js,
      lighthouse: input.lighthouse,
      lighthouse_pages: input.lighthouse_pages,
      lighthouse_strategies: input.lighthouse_strategies as Strategy[],
      thresholds: { ...DEFAULT_THRESHOLDS, ...input.thresholds },
    }
    if (input.render_js && (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN)) {
      return errorResult(ErrorCode.AUTH_DENIED, 'render_js needs Cloudflare Browser Rendering (CF_ACCOUNT_ID, CF_API_TOKEN).', 'Set them, or run without render_js.')
    }
    const id = newId()
    const rec = newRecord(id, site, options)
    writeAudit(s, rec)

    if (!input.background) {
      const done = await runAuditJob(s.dir, site, id, deps)
      return { success: done.status === 'done', audit_id: id, site, status: done.status, summary: done.summary, error: done.error ?? null }
    }

    const pid = launcher(s.dir, site, id)
    rec.pid = pid
    writeAudit(s, rec)
    return {
      success: true,
      audit_id: id,
      site,
      status: 'queued',
      state_file: s.recordPath(AUDITS, site, id),
      next: `Poll site_audit_status {site: "${site}", audit_id: "${id}"} every 30–60 s; when status is done, read site_audit_issues.`,
    }
  } catch (err) {
    return fail(err)
  }
}

export const siteAuditRunTool = {
  name: 'site_audit_run',
  description:
    'Use to audit a whole site, not a URL list: crawls same-origin pages from start_url (robots.txt-aware, sitemap-seeded, page and time budget, exclude_paths with robots-style patterns, ' +
    'backs off on HTTP 429 and records throttled URLs as rate_limited instead of broken, optional JS rendering via Cloudflare) in the background, then finds site-wide issues: ' +
    'broken internal links, orphan pages, pages with no outgoing links, deep pages, redirect chains/loops, duplicate titles/descriptions/content, thin content, heading skips, ' +
    'images without alt, slow responses, canonical conflicts, canonicalised and noindex pages, title/description length, missing/multiple H1, and crawl-limit notices; ' +
    'optional Lighthouse (mobile + desktop) on up to 10 representative pages. Returns an audit_id at once; poll site_audit_status, then read site_audit_issues / site_audit_pages / site_audit_lighthouse. ' +
    'Free (Lighthouse uses PageSpeed Insights; PSI_API_KEY recommended). Results are stored per site; one running audit per site.',
  inputSchema: {
    type: 'object',
    required: ['start_url'],
    properties: {
      start_url: { type: 'string', description: 'Absolute URL to start from, e.g. https://example.com/' },
      site: { type: 'string', description: 'Site key for storage (default: the start URL host)' },
      state_dir: siteProps.state_dir,
      max_pages: { type: 'number', description: 'Page budget (default 200, max 10000)', default: 200 },
      max_duration_s: { type: 'number', description: 'Time budget in seconds (default 900)', default: 900 },
      concurrency: { type: 'number', description: 'Parallel requests (1–8, default 4; drops to 1 on HTTP 429)', default: 4 },
      delay_ms: { type: 'number', description: 'Pause between requests per worker (default 250; robots.txt Crawl-delay wins if higher)', default: 250 },
      exclude_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Robots-style path patterns to skip: "/tag/", "/*?sort=", "/*.pdf$"',
      },
      include_sitemap: { type: 'boolean', description: 'Seed URLs from the sitemaps (needed to find orphan pages; default true)', default: true },
      render_js: { type: 'boolean', description: 'Render each page with Cloudflare Browser Rendering (paid per page; needs CF_ACCOUNT_ID/CF_API_TOKEN; default false)', default: false },
      lighthouse: { type: 'boolean', description: 'Run Lighthouse on representative pages after the crawl (default false)', default: false },
      lighthouse_pages: { type: 'number', description: 'How many representative pages (1–10, default 5)', default: 5 },
      lighthouse_strategies: { type: 'array', items: { type: 'string', enum: ['mobile', 'desktop'] }, description: 'Default both' },
      thresholds: {
        type: 'object',
        description: 'Override issue thresholds: thin_words (200), slow_ms (1000), deep_depth (3)',
        properties: { thin_words: { type: 'number' }, slow_ms: { type: 'number' }, deep_depth: { type: 'number' } },
      },
      background: { type: 'boolean', description: 'Return at once and run in the background (default true). false waits; use from cron/CLI.', default: true },
    },
  },
  annotations: { title: 'Start a site crawl audit', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}

export const siteAuditRunSpec = native({
  tool: siteAuditRunTool,
  schema: siteAuditRunInputSchema,
  run: async (input) => {
    const output = await runSiteAuditRun(input)
    return { output, isError: output.success === false }
  },
})

// ============================================================================
// site_audit_status
// ============================================================================

export const siteAuditStatusInputSchema = z.object(siteFields)

export function statusView(rec: AuditRecord, now: number = Date.now()): Record<string, unknown> {
  const status = effectiveStatus(rec, now)
  const elapsed = rec.started_at ? Math.round((now - Date.parse(rec.started_at)) / 1000) : 0
  const done = rec.progress.pages_crawled
  const rate = elapsed > 0 ? done / elapsed : 0
  const remainingPages = Math.max(0, Math.min(rec.options.max_pages - done, rec.progress.queued))
  return {
    success: true,
    audit_id: rec.id,
    site: rec.site,
    start_url: rec.options.start_url,
    status,
    ...(status === 'stalled' ? { hint: 'The worker stopped reporting (process ended or killed). Delete this audit and start again; partial results were not saved.' } : {}),
    created_at: rec.created_at,
    started_at: rec.started_at,
    finished_at: rec.finished_at,
    progress: {
      ...rec.progress,
      max_pages: rec.options.max_pages,
      elapsed_s: elapsed,
      eta_s: status === 'running' && rate > 0 ? Math.round(remainingPages / rate) : null,
    },
    lighthouse: { status: rec.lighthouse.status, pages: rec.lighthouse.pages.length, runs_done: rec.lighthouse.runs.length },
    summary: rec.summary,
    crawl: rec.crawl,
    error: rec.error ?? null,
  }
}

export const siteAuditStatusTool = {
  name: 'site_audit_status',
  description:
    'Use to poll a site audit started with site_audit_run: status (queued, running, lighthouse, done, failed, cancelled, or stalled if the worker died), progress with ETA, ' +
    'and when done the summary (pages by status, issue counts by severity, health score) and crawl facts (robots.txt, sitemap URLs, page/time limit reached). Newest audit by default.',
  inputSchema: { type: 'object', required: ['site'], properties: siteProps },
  annotations: { title: 'Site audit status', readOnlyHint: true, openWorldHint: false },
}

export const siteAuditStatusSpec = native({
  tool: siteAuditStatusTool,
  schema: siteAuditStatusInputSchema,
  run: async (input) => {
    try {
      return { output: statusView(pickAudit(store(), siteKey(input.site), input.audit_id)), isError: false }
    } catch (err) {
      return { output: fail(err), isError: true }
    }
  },
})

// ============================================================================
// site_audit_issues
// ============================================================================

export const siteAuditIssuesInputSchema = z.object({
  ...siteFields,
  severity: z.array(z.enum(['error', 'warning', 'notice'])).optional(),
  types: z.array(z.string()).optional(),
  pages_per_issue: z.number().int().min(0).max(1000).optional().default(20),
})

function notDone(rec: AuditRecord): Fail | null {
  if (rec.issues) return null
  return errorResult(ErrorCode.INVALID_INPUT, `Audit ${rec.id} is ${effectiveStatus(rec)}; issues are available when the crawl finishes.`, 'Poll site_audit_status.')
}

export const siteAuditIssuesTool = {
  name: 'site_audit_issues',
  description:
    'Use after a site audit finishes: the site-wide issues, most severe first, each with type, severity (error/warning/notice), title, a concrete how_to_fix, ' +
    'the number of affected pages and up to pages_per_issue example URLs with details. Filter by severity or issue types. Newest audit by default.',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      ...siteProps,
      severity: { type: 'array', items: { type: 'string', enum: ['error', 'warning', 'notice'] }, description: 'Only these severities' },
      types: { type: 'array', items: { type: 'string' }, description: 'Only these issue types, e.g. ["broken-internal-link","orphan-page"]' },
      pages_per_issue: { type: 'number', description: 'Example pages per issue (default 20, 0 = counts only)', default: 20 },
    },
  },
  annotations: { title: 'Site audit issues', readOnlyHint: true, openWorldHint: false },
}

export const siteAuditIssuesSpec = native({
  tool: siteAuditIssuesTool,
  schema: siteAuditIssuesInputSchema,
  run: async (input) => {
    try {
      const rec = pickAudit(store(), siteKey(input.site), input.audit_id)
      const nd = notDone(rec)
      if (nd) return { output: nd, isError: true }
      const issues = (rec.issues ?? [])
        .filter((i) => !input.severity || input.severity.includes(i.severity as Severity))
        .filter((i) => !input.types || input.types.includes(i.type))
        .map((i) => ({ ...i, pages: i.pages.slice(0, input.pages_per_issue), pages_truncated: i.pages.length > input.pages_per_issue }))
      return { output: { success: true, audit_id: rec.id, site: rec.site, summary: rec.summary, issues }, isError: false }
    } catch (err) {
      return { output: fail(err), isError: true }
    }
  },
})

// ============================================================================
// site_audit_pages
// ============================================================================

const STATUS_KINDS = ['ok', 'redirect', 'client_error', 'server_error', 'blocked_robots', 'rate_limited', 'fetch_error', 'non_html'] as const

export const siteAuditPagesInputSchema = z.object({
  ...siteFields,
  status_kind: z.array(z.enum(STATUS_KINDS)).optional(),
  issue_type: z.string().optional(),
  url_contains: z.string().optional(),
  sort: z.enum(['url', 'depth', 'inlinks', 'response_ms', 'word_count']).optional().default('url'),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  offset: z.number().int().min(0).optional().default(0),
  fields: z.enum(['summary', 'full']).optional().default('summary'),
})

export function pageSummary(p: CrawledPage): Record<string, unknown> {
  return {
    url: p.url,
    status: p.status,
    status_kind: p.status_kind,
    final_url: p.final_url !== p.url ? p.final_url : undefined,
    depth: p.depth,
    inlinks: p.inlinks,
    internal_links_out: p.internal_links.length,
    response_ms: p.response_ms,
    title: p.title,
    word_count: p.word_count,
    noindex: p.noindex || undefined,
    canonical: p.canonicals[0] && p.canonicals[0] !== p.url ? p.canonicals[0] : undefined,
    in_sitemap: p.in_sitemap,
  }
}

export const siteAuditPagesTool = {
  name: 'site_audit_pages',
  description:
    'Use to inspect crawled pages from a site audit: filter by status_kind (ok, redirect, client_error, server_error, blocked_robots, rate_limited, fetch_error, non_html), ' +
    'by an issue type (pages affected by it) or a URL substring; sort by url, depth, inlinks, response_ms or word_count; page with limit/offset. ' +
    'fields "full" adds headings, links, canonicals and redirect chains.',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      ...siteProps,
      status_kind: { type: 'array', items: { type: 'string', enum: [...STATUS_KINDS] } },
      issue_type: { type: 'string', description: 'Only pages affected by this issue type' },
      url_contains: { type: 'string' },
      sort: { type: 'string', enum: ['url', 'depth', 'inlinks', 'response_ms', 'word_count'], default: 'url' },
      limit: { type: 'number', default: 100 },
      offset: { type: 'number', default: 0 },
      fields: { type: 'string', enum: ['summary', 'full'], default: 'summary' },
    },
  },
  annotations: { title: 'Site audit pages', readOnlyHint: true, openWorldHint: false },
}

export const siteAuditPagesSpec = native({
  tool: siteAuditPagesTool,
  schema: siteAuditPagesInputSchema,
  run: async (input) => {
    try {
      const s = store()
      const site = siteKey(input.site)
      const rec = pickAudit(s, site, input.audit_id)
      const nd = notDone(rec)
      if (nd) return { output: nd, isError: true }
      let pages = readPages(s, site, rec.id) ?? []
      if (input.status_kind) pages = pages.filter((p) => input.status_kind!.includes(p.status_kind as StatusKind))
      if (input.url_contains) pages = pages.filter((p) => p.url.includes(input.url_contains!))
      if (input.issue_type) {
        const urls = new Set((rec.issues ?? []).find((i) => i.type === input.issue_type)?.pages.map((p) => p.url) ?? [])
        pages = pages.filter((p) => urls.has(p.url))
      }
      const key = input.sort
      pages.sort((a, b) => {
        if (key === 'url') return a.url.localeCompare(b.url)
        const av = (a[key] as number | null) ?? -1
        const bv = (b[key] as number | null) ?? -1
        return key === 'depth' ? av - bv : bv - av
      })
      const total = pages.length
      const slice = pages.slice(input.offset, input.offset + input.limit)
      return {
        output: {
          success: true,
          audit_id: rec.id,
          site,
          total,
          offset: input.offset,
          pages: input.fields === 'full' ? slice : slice.map(pageSummary),
        },
        isError: false,
      }
    } catch (err) {
      return { output: fail(err), isError: true }
    }
  },
})

// ============================================================================
// site_audit_lighthouse
// ============================================================================

export const siteAuditLighthouseInputSchema = z.object({
  ...siteFields,
  run: z.boolean().optional().default(false).describe('Start Lighthouse on this finished audit if it has none yet'),
  pages: z.number().int().min(1).max(10).optional(),
  strategies: z.array(z.enum(['mobile', 'desktop'])).min(1).optional(),
})

export async function runSiteAuditLighthouse(
  input: z.infer<typeof siteAuditLighthouseInputSchema>,
  launcher: typeof launchWorker = launchWorker,
): Promise<Record<string, unknown> | Fail> {
  try {
    const s = store()
    const site = siteKey(input.site)
    const rec = pickAudit(s, site, input.audit_id)
    const status = effectiveStatus(rec)
    if (input.run && rec.lighthouse.status !== 'running') {
      if (status !== 'done') {
        return errorResult(ErrorCode.INVALID_INPUT, `Audit ${rec.id} is ${status}; Lighthouse can start once the crawl is done.`, 'Poll site_audit_status.')
      }
      rec.status = 'lighthouse'
      rec.lighthouse = {
        status: 'pending',
        pages: [],
        strategies: (input.strategies as Strategy[] | undefined) ?? rec.options.lighthouse_strategies,
        runs: [],
      }
      if (input.pages) rec.options.lighthouse_pages = input.pages
      rec.progress.updated_at = new Date().toISOString()
      rec.finished_at = null
      writeAudit(s, rec)
      rec.pid = launcher(s.dir, site, rec.id)
      writeAudit(s, rec)
      return { success: true, audit_id: rec.id, site, lighthouse: { status: 'pending' }, next: 'Poll site_audit_status; read this tool again when lighthouse.status is done.' }
    }
    const runs = rec.lighthouse.runs
    const scores = (key: 'performance' | 'seo' | 'accessibility' | 'best_practices', strategy: Strategy): number | null => {
      const vals = runs.filter((r) => r.strategy === strategy && r.scores[key] !== null).map((r) => r.scores[key] as number)
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    }
    return {
      success: true,
      audit_id: rec.id,
      site,
      lighthouse_status: rec.lighthouse.status,
      ...(rec.lighthouse.status === 'not_requested' ? { hint: 'This audit ran without Lighthouse. Call again with run: true.' } : {}),
      averages: Object.fromEntries(
        rec.lighthouse.strategies.map((st) => [st, { performance: scores('performance', st), accessibility: scores('accessibility', st), best_practices: scores('best_practices', st), seo: scores('seo', st) }]),
      ),
      runs,
      notes: ['INP has no lab value: it is reported from Chrome UX Report field data (field.inp_ms) when the page or origin has enough traffic.'],
      error: rec.lighthouse.error ?? null,
    }
  } catch (err) {
    return fail(err)
  }
}

export const siteAuditLighthouseTool = {
  name: 'site_audit_lighthouse',
  description:
    'Use for page speed of a crawled site: Lighthouse results from a site audit for up to 10 representative pages (home page + most-linked page per section), mobile and desktop: ' +
    'performance/accessibility/best-practices/SEO scores, lab LCP, CLS, TBT and TTFB, field (Chrome UX Report) LCP, CLS, INP and TTFB, and per page the top savings with the resources behind them. ' +
    'If the audit ran without Lighthouse, run: true starts it in the background (free via PageSpeed Insights; set PSI_API_KEY for quota).',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      ...siteProps,
      run: { type: 'boolean', description: 'Start Lighthouse on this finished audit (default false = read results)', default: false },
      pages: { type: 'number', description: 'Representative pages when run is true (1–10)' },
      strategies: { type: 'array', items: { type: 'string', enum: ['mobile', 'desktop'] } },
    },
  },
  annotations: { title: 'Site audit Lighthouse', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}

export const siteAuditLighthouseSpec = native({
  tool: siteAuditLighthouseTool,
  schema: siteAuditLighthouseInputSchema,
  run: async (input) => {
    const output = await runSiteAuditLighthouse(input)
    return { output, isError: output.success === false }
  },
})

// ============================================================================
// site_audit_list / site_audit_delete
// ============================================================================

export const siteAuditListInputSchema = z.object({
  site: z.string().optional(),
  state_dir: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional().default(20),
})

export const siteAuditListTool = {
  name: 'site_audit_list',
  description: 'Use to find stored site audits: newest first, per site (or every site when site is omitted), with status, start URL, page count, issue counts and health score.',
  inputSchema: {
    type: 'object',
    properties: {
      site: siteProps.site,
      state_dir: siteProps.state_dir,
      limit: { type: 'number', default: 20 },
    },
  },
  annotations: { title: 'List site audits', readOnlyHint: true, openWorldHint: false },
}

export const siteAuditListSpec = native({
  tool: siteAuditListTool,
  schema: siteAuditListInputSchema,
  run: async (input) => {
    try {
      const s = store()
      const sites = input.site ? [siteKey(input.site)] : s.listSites(AUDITS)
      const audits = sites
        .flatMap((site) => s.listRecordIds(AUDITS, site).map((id) => readAudit(s, site, id)))
        .filter((r): r is AuditRecord => r !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, input.limit)
        .map((r) => ({
          audit_id: r.id,
          site: r.site,
          start_url: r.options.start_url,
          status: effectiveStatus(r),
          created_at: r.created_at,
          pages_crawled: r.summary?.pages_crawled ?? r.progress.pages_crawled,
          issues: r.summary?.issues ?? null,
          health_score: r.summary?.health_score ?? null,
          lighthouse: r.lighthouse.status,
        }))
      return { output: { success: true, audits }, isError: false }
    } catch (err) {
      return { output: fail(err), isError: true }
    }
  },
})

export const siteAuditDeleteInputSchema = z.object({
  site: z.string().min(1),
  audit_id: z.string().min(1),
  state_dir: z.string().optional(),
})

export const siteAuditDeleteTool = {
  name: 'site_audit_delete',
  description: 'Use to remove a stored site audit (its record and crawled pages). A running audit is stopped first.',
  inputSchema: {
    type: 'object',
    required: ['site', 'audit_id'],
    properties: { site: siteProps.site, audit_id: { type: 'string' }, state_dir: siteProps.state_dir },
  },
  annotations: { title: 'Delete a site audit', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const siteAuditDeleteSpec = native({
  tool: siteAuditDeleteTool,
  schema: siteAuditDeleteInputSchema,
  run: async (input) => {
    try {
      const s = store()
      const site = siteKey(input.site)
      const id = safeId(input.audit_id)
      const rec = readAudit(s, site, id)
      let stopped = false
      if (rec?.pid && ['queued', 'running', 'lighthouse'].includes(rec.status)) {
        try {
          process.kill(rec.pid, 'SIGTERM')
          stopped = true
        } catch {
          stopped = false
        }
      }
      const deleted = s.deleteRecord(AUDITS, site, id)
      s.deleteRecord(AUDIT_PAGES, site, id)
      if (!deleted) return { output: errorResult(ErrorCode.NOT_FOUND, `Audit ${id} not found for ${site}.`), isError: true }
      return { output: { success: true, audit_id: id, site, deleted: true, stopped_worker: stopped }, isError: false }
    } catch (err) {
      return { output: fail(err), isError: true }
    }
  },
})
