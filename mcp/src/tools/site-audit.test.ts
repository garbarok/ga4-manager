import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSiteAuditRun, runSiteAuditLighthouse, statusView } from './site-audit.js'
import { dispatchTool } from '../dispatch.js'
import { runWithContext, type ToolContext } from '../utils/tool-context.js'
import { StateStore } from '../utils/state-store.js'
import { runAuditJob, readAudit, newRecord, writeAudit, DEFAULT_AUDIT_OPTIONS, effectiveStatus, AUDITS } from '../audit/audit-job.js'
import { parsePsi, pickRepresentativePages, type PsiResponse } from '../audit/lighthouse.js'
import { fakeFetcher } from '../audit/__fixtures__/fake-site.js'
import { CLIExecutor } from '../cli/executor.js'

const executor = new CLIExecutor('/nonexistent/ga4')
const sleep = async (): Promise<void> => {}

function ctxFor(dir: string): ToolContext {
  return { tool: 'site_audit_run', site: 'example.com', stateDir: dir, refresh: false, lookups: [] }
}

const PSI: PsiResponse = {
  loadingExperience: { id: 'https://example.com/', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 600 } } },
  lighthouseResult: {
    categories: { performance: { score: 0.81 }, accessibility: { score: 0.95 }, 'best-practices': { score: 1 }, seo: { score: 0.92 } },
    audits: {
      'largest-contentful-paint': { numericValue: 2534.4 },
      'cumulative-layout-shift': { numericValue: 0.0412 },
      'total-blocking-time': { numericValue: 120 },
      'server-response-time': { numericValue: 310 },
      'first-contentful-paint': { numericValue: 900 },
      'render-blocking-resources': { title: 'Eliminate render-blocking resources', details: { type: 'opportunity', overallSavingsMs: 450, items: [{ url: 'https://example.com/app.css', wastedMs: 450, totalBytes: 20000 }] } },
      'unused-javascript': { title: 'Reduce unused JavaScript', details: { type: 'opportunity', overallSavingsMs: 300, overallSavingsBytes: 80000, items: [{ url: 'https://example.com/app.js', wastedBytes: 80000 }] } },
      'uses-http2': { title: 'No savings', details: { type: 'opportunity', overallSavingsMs: 0 } },
      'critical-request-chains': { title: 'Chains', details: { type: 'criticalrequestchain', items: { chains: {} } as unknown as [] } },
    },
  },
}

describe('parsePsi', () => {
  it('extracts scores, lab and field metrics and top savings', () => {
    const run = parsePsi('https://example.com/', 'mobile', PSI, new Date('2026-01-01T00:00:00Z'))
    expect(run.scores).toEqual({ performance: 81, accessibility: 95, best_practices: 100, seo: 92 })
    expect(run.lab).toEqual({ lcp_ms: 2534, cls: 0.041, tbt_ms: 120, ttfb_ms: 310, fcp_ms: 900 })
    expect(run.field).toEqual({ source: 'url', lcp_ms: 2100, cls: 0.05, inp_ms: 180, ttfb_ms: 600 })
    expect(run.top_savings.map((s) => s.id)).toEqual(['render-blocking-resources', 'unused-javascript'])
    expect(run.top_savings[1].resources[0]).toEqual({ url: 'https://example.com/app.js', wasted_bytes: 80000 })
  })
  it('falls back to origin field data', () => {
    const run = parsePsi('https://example.com/x', 'desktop', { originLoadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 90 } } } })
    expect(run.field).toMatchObject({ source: 'origin', inp_ms: 90 })
    expect(run.scores.performance).toBeNull()
  })
})

describe('site audit job', () => {
  it('runs a foreground audit end to end and stores issues, pages and Lighthouse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-audit-'))
    const { fetch } = fakeFetcher()
    const psiCalls: string[] = []
    const out = await runWithContext(ctxFor(dir), () =>
      runSiteAuditRun(
        { start_url: 'https://example.com/', max_pages: 100, max_duration_s: 60, concurrency: 2, delay_ms: 0, exclude_paths: [], include_sitemap: true, render_js: false, lighthouse: true, lighthouse_pages: 3, lighthouse_strategies: ['mobile'], thresholds: {}, background: false },
        () => null,
        { fetch, sleep, psi: async (url) => (psiCalls.push(url), PSI) },
      ),
    )
    expect(out).toMatchObject({ success: true, status: 'done', site: 'example.com' })
    expect(psiCalls).toHaveLength(3)
    expect(psiCalls[0]).toBe('https://example.com/')

    const issues = await dispatchTool('site_audit_issues', { site: 'example.com', state_dir: dir, severity: ['error'], pages_per_issue: 1 }, executor)
    const iout = issues.output as { issues: { type: string; severity: string; pages: unknown[]; pages_truncated: boolean }[] }
    expect(iout.issues.every((i) => i.severity === 'error')).toBe(true)
    expect(iout.issues.find((i) => i.type === 'broken-internal-link')).toBeDefined()
    expect(iout.issues.every((i) => i.pages.length <= 1)).toBe(true)

    const pages = await dispatchTool('site_audit_pages', { site: 'example.com', state_dir: dir, status_kind: ['client_error'] }, executor)
    expect((pages.output as { pages: { url: string }[] }).pages.map((p) => p.url)).toContain('https://example.com/broken')
    const byIssue = await dispatchTool('site_audit_pages', { site: 'example.com', state_dir: dir, issue_type: 'orphan-page' }, executor)
    expect((byIssue.output as { total: number }).total).toBe(1)

    const lh = await dispatchTool('site_audit_lighthouse', { site: 'example.com', state_dir: dir }, executor)
    expect(lh.output).toMatchObject({ lighthouse_status: 'done', averages: { mobile: { performance: 81 } } })

    const list = await dispatchTool('site_audit_list', { state_dir: dir }, executor)
    expect((list.output as { audits: unknown[] }).audits).toHaveLength(1)

    const id = (out as { audit_id: string }).audit_id
    const del = await dispatchTool('site_audit_delete', { site: 'example.com', audit_id: id, state_dir: dir }, executor)
    expect(del.output).toMatchObject({ deleted: true })
    const gone = await dispatchTool('site_audit_status', { site: 'example.com', state_dir: dir }, executor)
    expect(gone.output).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })

  it('background start returns at once with an id and refuses a second running audit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-audit-'))
    const launched: string[] = []
    const input = { start_url: 'https://example.com/', max_pages: 10, max_duration_s: 60, concurrency: 1, delay_ms: 0, exclude_paths: [], include_sitemap: false, render_js: false, lighthouse: false, lighthouse_pages: 5, lighthouse_strategies: ['mobile' as const], thresholds: {}, background: true }
    const first = await runWithContext(ctxFor(dir), () => runSiteAuditRun(input, (_d, _s, id) => (launched.push(id), process.pid)))
    expect(first).toMatchObject({ success: true, status: 'queued' })
    expect(launched).toHaveLength(1)
    const second = await runWithContext(ctxFor(dir), () => runSiteAuditRun(input, () => process.pid))
    expect(second).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })

    // Issues are not available until the crawl is done.
    const early = await dispatchTool('site_audit_issues', { site: 'example.com', state_dir: dir }, executor)
    expect(early.output).toMatchObject({ success: false })

    // The worker then runs the job to completion.
    const { fetch } = fakeFetcher()
    const rec = await runAuditJob(dir, 'example.com', launched[0], { fetch, sleep })
    expect(rec.status).toBe('done')
  })

  it('reports a job whose worker died as stalled', () => {
    const rec = newRecord('20260101T000000Z-aaaaaa', 'example.com', { ...DEFAULT_AUDIT_OPTIONS, start_url: 'https://example.com/' }, new Date('2026-01-01T00:00:00Z'))
    rec.status = 'running'
    rec.started_at = rec.created_at
    rec.pid = 2 ** 22 + 12345 // no such process
    expect(effectiveStatus(rec, Date.parse('2026-01-01T00:01:00Z'))).toBe('stalled')
    expect(statusView(rec, Date.parse('2026-01-01T00:01:00Z'))).toMatchObject({ status: 'stalled', hint: expect.stringMatching(/Delete this audit/) })
  })

  it('site_audit_lighthouse run:true starts the Lighthouse phase on a finished audit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-audit-'))
    const store = new StateStore(dir)
    const { fetch } = fakeFetcher()
    const rec = newRecord('20260101T000000Z-bbbbbb', 'example.com', { ...DEFAULT_AUDIT_OPTIONS, start_url: 'https://example.com/', delay_ms: 0 })
    writeAudit(store, rec)
    await runAuditJob(dir, 'example.com', rec.id, { fetch, sleep })
    const started = await runWithContext(ctxFor(dir), () => runSiteAuditLighthouse({ site: 'example.com', state_dir: dir, run: true, pages: 2, strategies: ['desktop'] }, () => null))
    expect(started).toMatchObject({ success: true, lighthouse: { status: 'pending' } })
    const done = await runAuditJob(dir, 'example.com', rec.id, { fetch, sleep, psi: async () => PSI })
    expect(done.lighthouse).toMatchObject({ status: 'done', strategies: ['desktop'] })
    expect(done.lighthouse.runs).toHaveLength(2)
    expect(readAudit(store, 'example.com', rec.id)!.status).toBe('done')
    expect(store.listRecordIds(AUDITS, 'example.com')).toEqual([rec.id])
  })

  it('pickRepresentativePages covers the start URL and distinct sections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga4-audit-'))
    const store = new StateStore(dir)
    const { fetch } = fakeFetcher()
    const rec = newRecord('20260101T000000Z-cccccc', 'example.com', { ...DEFAULT_AUDIT_OPTIONS, start_url: 'https://example.com/', delay_ms: 0 })
    writeAudit(store, rec)
    await runAuditJob(dir, 'example.com', rec.id, { fetch, sleep })
    const pages = store.readRecord<import('../audit/crawler.js').CrawledPage[]>('site-audit-pages', 'example.com', rec.id)!.data
    const picked = pickRepresentativePages(pages, 'https://example.com/', 4)
    expect(picked[0]).toBe('https://example.com/')
    expect(new Set(picked.map((u) => new URL(u).pathname.split('/')[1])).size).toBe(4)
  })
})

describe('representative pages on multilingual sites (B8)', () => {
  it('picks page types, not one page per language', async () => {
    const { pickRepresentativePages } = await import('../audit/lighthouse.js')
    const page = (path: string, inlinks: number) => ({
      url: `https://example.com${path}`, final_url: `https://example.com${path}`, status: 200, status_kind: 'ok', content_type: 'text/html',
      noindex: false, canonicals: [], inlinks,
    }) as unknown as import('../audit/crawler.js').CrawledPage
    const pages = [
      page('/en', 50), page('/en/blog', 40), page('/es/blog', 40), page('/de/blog', 40), page('/fr/blog', 40),
      page('/en/guides/a', 30), page('/en/tools/calc', 20), page('/es/guias/a', 25),
    ]
    expect(pickRepresentativePages(pages, 'https://example.com/en', 4)).toEqual([
      'https://example.com/en',
      'https://example.com/en/blog',
      'https://example.com/en/guides/a',
      'https://example.com/en/tools/calc',
    ])
  })
})
