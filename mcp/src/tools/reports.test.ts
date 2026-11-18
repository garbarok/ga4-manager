import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runReportSave,
  runReportList,
  runReportGet,
  runReportDelete,
  runReportTemplateSave,
  runReportTemplateList,
  runReportTemplateDelete,
  reportSaveInputSchema,
} from './reports.js'
import { BUILT_IN_TEMPLATES } from '../reports/templates.js'
import { dispatchTool } from '../dispatch.js'
import { CLIExecutor } from '../cli/executor.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ga4-reports-'))
})

const TOOL_OUTPUT = {
  success: true,
  site: 'example.com',
  coverage: { rows_considered: 3, matched: 2, unmatched: 1 },
  pages: [
    { page: 'https://example.com/a', position: 6.2, score: 71, title: '<script>alert(1)</script>' },
    { page: 'https://example.com/b', position: 11.8, score: null },
  ],
}

function save(extra: Record<string, unknown>, now = new Date('2026-02-01T10:00:00Z')) {
  return runReportSave(reportSaveInputSchema.parse({ site: 'sc-domain:example.com', title: 'Report', state_dir: dir, ...extra }), now)
}

describe('report_save', () => {
  it('writes metadata and a self-contained HTML file per site', () => {
    const out = save({ tool_output: TOOL_OUTPUT })
    if (!out.success) throw new Error(out.error.message)
    expect(out.site).toBe('example.com')
    expect(out.path).toBe(join(dir, 'reports', 'example.com', `${out.id}.html`))
    expect(readdirSync(join(dir, 'reports', 'example.com')).sort()).toEqual([`${out.id}.html`, `${out.id}.json`])
    const html = readFileSync(out.path, 'utf8')
    expect(out.size_bytes).toBe(Buffer.byteLength(html))
    expect(html).toContain('https://example.com/a')
    expect(html).not.toContain('<script>')
    expect(out.sections).toEqual([{ heading: 'Result', kinds: ['data'] }])
  })

  it('renders explicit sections with markdown, data and charts', () => {
    const out = save({
      sections: [
        { heading: 'Summary', markdown: 'Clicks **up**.' },
        { heading: 'Pages', data: TOOL_OUTPUT.pages, chart: { labels: ['a', 'b'], values: [1, 2] } },
      ],
      intro: 'Monthly numbers.',
    })
    if (!out.success) throw new Error(out.error.message)
    expect(out.sections.map((s) => s.heading)).toEqual(['Overview', 'Summary', 'Pages'])
    expect(out.sections[2]).toEqual({ heading: 'Pages', kinds: ['chart', 'data'], rows: 2 })
  })

  it('fills a built-in template and marks unfilled sections as not run', () => {
    const out = save({
      template: 'monthly_seo_checkin',
      section_data: { 'Top search queries': [{ query: 'q', clicks: 3 }], 'Summary and next steps': '- do x' },
    })
    if (!out.success) throw new Error(out.error.message)
    expect(out.template).toBe('monthly_seo_checkin')
    expect(out.not_run).toContain('Organic traffic')
    expect(out.not_run).not.toContain('Top search queries')
    expect(out.sections.find((s) => s.heading === 'Summary and next steps')?.kinds).toEqual(['markdown'])
    const html = readFileSync(out.path, 'utf8')
    expect(html).toContain('Not run.')
    expect(html).toContain('<code>ga4_organic_overview</code>')
  })

  it('rejects unknown templates, unknown headings and ambiguous input', () => {
    expect(save({ template: 'nope' })).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
    expect(save({ template: 'monthly_seo_checkin', section_data: { Bogus: 1 } })).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    expect(() => reportSaveInputSchema.parse({ site: 'example.com', title: 't', tool_output: 1, sections: [{ heading: 'x' }] })).toThrow()
    expect(() => reportSaveInputSchema.parse({ site: 'example.com', title: 't' })).toThrow()
  })
})

describe('report_list / report_get / report_delete', () => {
  it('lists newest first, filters by site, gets html/path/meta, deletes both files', () => {
    const a = save({ tool_output: { n: 1 } }, new Date('2026-01-01T00:00:00Z'))
    const b = save({ tool_output: { n: 2 } }, new Date('2026-03-01T00:00:00Z'))
    const other = runReportSave(reportSaveInputSchema.parse({ site: 'example.org', title: 'Other', tool_output: {}, state_dir: dir }))
    if (!a.success || !b.success || !other.success) throw new Error('save failed')

    const all = runReportList({ state_dir: dir, limit: 50 })
    if (!all.success) throw new Error('list failed')
    expect(all.total).toBe(3)
    const mine = runReportList({ site: 'example.com', state_dir: dir, limit: 50 })
    if (!mine.success) throw new Error('list failed')
    expect(mine.reports.map((r) => r.id)).toEqual([b.id, a.id])

    const newest = runReportGet({ site: 'example.com', state_dir: dir, format: 'meta' })
    expect(newest).toMatchObject({ success: true, id: b.id, path: b.path })
    expect(newest).not.toHaveProperty('html')
    const html = runReportGet({ site: 'example.com', id: a.id, state_dir: dir, format: 'html' })
    if (!html.success) throw new Error('get failed')
    expect(html.html).toContain('<!doctype html>')

    expect(runReportDelete({ site: 'example.com', id: a.id, state_dir: dir })).toMatchObject({ success: true, deleted: true })
    expect(existsSync(a.path)).toBe(false)
    expect(runReportGet({ site: 'example.com', id: a.id, state_dir: dir, format: 'meta' })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(runReportDelete({ site: 'example.com', id: a.id, state_dir: dir })).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('reports an empty site and rejects path-traversal ids', () => {
    expect(runReportGet({ site: 'example.com', state_dir: dir, format: 'meta' })).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(runReportDelete({ site: 'example.com', id: '../../etc', state_dir: dir })).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })
})

describe('report templates', () => {
  const tpl = {
    name: 'client_monthly',
    title: 'Client monthly',
    description: 'For a client',
    sections: [
      { heading: 'Traffic', instructions: 'Run ga4_organic_overview', tool: 'ga4_organic_overview' },
      { heading: 'Notes', instructions: 'Write notes' },
    ],
  }

  it('saves global and site templates; site hides global; built-ins are read-only', () => {
    expect(runReportTemplateSave({ ...tpl, state_dir: dir })).toMatchObject({ success: true, scope: 'global', created: true })
    expect(runReportTemplateSave({ ...tpl, state_dir: dir })).toMatchObject({ success: true, created: false })
    expect(runReportTemplateSave({ ...tpl, title: 'Site version', site: 'example.com', state_dir: dir })).toMatchObject({ scope: 'site', site: 'example.com' })

    const global = runReportTemplateList({ state_dir: dir })
    if (!global.success) throw new Error('list failed')
    expect(global.templates.map((t) => [t.name, t.scope])).toEqual([
      ['monthly_seo_checkin', 'built_in'],
      ['client_monthly', 'global'],
    ])
    const scoped = runReportTemplateList({ site: 'example.com', state_dir: dir })
    if (!scoped.success) throw new Error('list failed')
    expect(scoped.templates.find((t) => t.name === 'client_monthly')).toMatchObject({ scope: 'site', title: 'Site version' })

    expect(existsSync(join(dir, 'report-templates.json'))).toBe(true)
    expect(existsSync(join(dir, 'report-templates.example.com.json'))).toBe(true)

    expect(runReportTemplateSave({ ...tpl, name: 'monthly_seo_checkin', state_dir: dir })).toMatchObject({ success: false })
    expect(runReportTemplateDelete({ name: 'monthly_seo_checkin', state_dir: dir })).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
  })

  it('uses a site template in report_save', () => {
    runReportTemplateSave({ ...tpl, site: 'example.com', state_dir: dir })
    const out = save({ template: 'client_monthly', section_data: { Notes: 'All fine.' } })
    expect(out).toMatchObject({ success: true, template: 'client_monthly', not_run: ['Traffic'] })
  })

  it('rejects duplicate headings and bad names; deletes', () => {
    expect(runReportTemplateSave({ ...tpl, sections: [tpl.sections[0], tpl.sections[0]], state_dir: dir })).toMatchObject({ success: false })
    expect(runReportTemplateSave({ ...tpl, name: 'Bad Name', state_dir: dir })).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } })
    runReportTemplateSave({ ...tpl, state_dir: dir })
    expect(runReportTemplateDelete({ name: 'client_monthly', state_dir: dir })).toMatchObject({ success: true, scope: 'global' })
    expect(runReportTemplateDelete({ name: 'client_monthly', state_dir: dir })).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('the built-in monthly check-in chains the OpenSEO-parity tools with unique headings', () => {
    const monthly = BUILT_IN_TEMPLATES.find((t) => t.name === 'monthly_seo_checkin')!
    const tools = monthly.sections.map((s) => s.tool).filter(Boolean)
    expect(tools).toEqual([
      'ga4_organic_overview',
      'gsc_analytics_run',
      'page_opportunities',
      'site_audit_issues',
      'rank_tracker_get',
      'ai_visibility_trend',
      'project_context_get',
    ])
    const headings = monthly.sections.map((s) => s.heading)
    expect(new Set(headings).size).toBe(headings.length)
  })
})

describe('dispatch + CLI parity', () => {
  it('report_save and report_list run through the shared dispatcher', async () => {
    const executor = new CLIExecutor('/nonexistent/ga4')
    const saved = await dispatchTool('report_save', { site: 'example.com', title: 'T', tool_output: { a: 1 }, state_dir: dir }, executor)
    expect(saved.isError).toBe(false)
    const listed = await dispatchTool('report_list', { site: 'example.com', state_dir: dir }, executor)
    expect(listed.output).toMatchObject({ success: true, total: 1 })
  })
})
