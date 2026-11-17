import { z } from 'zod'
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { native } from '../tool-spec.js'
import { StateStore, resolveStateDir, siteKey, newId, safeId } from '../utils/state-store.js'
import { ToolError, ErrorCode, errorResult, toolErrorToFailure, type ToolFailureResult } from '../utils/errors.js'
import { renderReport, type ReportSection } from '../reports/render.js'
import { saveTemplate, deleteTemplate, listTemplates, findTemplate, type ListedTemplate } from '../reports/templates.js'

/**
 * Saved reports (OpenSEO save_report / list / get / delete / templates).
 *
 * A report is one self-contained HTML file written from any tool output,
 * stored per site in the state dir:
 *   <state_dir>/reports/<site>/<id>.json   metadata (shared state envelope)
 *   <state_dir>/reports/<site>/<id>.html   the page
 * Sharing is the file itself: report_get returns its path or its HTML, and the
 * Operator (or an assistant) sends or publishes it. Nothing is uploaded.
 */

export const REPORTS_COLLECTION = 'reports'

// ============================================================================
// Shared input pieces
// ============================================================================

const stateInputs = {
  config: z.string().optional().describe('Site config path; state lives in .ga4-state/ next to it'),
  state_dir: z.string().optional().describe('Override the state directory'),
}

const stateInputProps = {
  config: { type: 'string', description: 'Site config path; state is stored in .ga4-state/ next to it.' },
  state_dir: { type: 'string', description: 'Override the state directory (default: GA4M_STATE_DIR, next to config, or ./.ga4-state).' },
}

function storeFor(input: { config?: string; state_dir?: string }): StateStore {
  return new StateStore(resolveStateDir({ stateDir: input.state_dir, config: input.config }))
}

function fail(err: unknown): ToolFailureResult {
  if (err instanceof ToolError) return toolErrorToFailure(err)
  return errorResult(ErrorCode.INVALID_INPUT, err instanceof Error ? err.message : String(err))
}

function done<T extends { success: boolean }>(output: T) {
  return { output, isError: !output.success }
}

function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, path)
}

// ============================================================================
// Report metadata
// ============================================================================

export interface SectionSummary {
  heading: string
  kinds: ('markdown' | 'data' | 'chart' | 'not_run')[]
  /** Row count when the section's data is an array. */
  rows?: number
}

export interface ReportMeta {
  id: string
  title: string
  site: string
  created_at: string
  template: string | null
  sections: SectionSummary[]
  html_file: string
  size_bytes: number
}

function summarize(sections: ReportSection[]): SectionSummary[] {
  return sections.map((s) => {
    const kinds: SectionSummary['kinds'] = []
    if (s.not_run) kinds.push('not_run')
    if (s.markdown) kinds.push('markdown')
    if (s.chart) kinds.push('chart')
    if (s.data !== undefined) kinds.push('data')
    return { heading: s.heading, kinds, ...(Array.isArray(s.data) ? { rows: s.data.length } : {}) }
  })
}

function htmlPath(store: StateStore, site: string, id: string): string {
  return join(store.collectionDir(REPORTS_COLLECTION, site), `${safeId(id)}.html`)
}

// ============================================================================
// report_save
// ============================================================================

const chartSchema = z.object({
  title: z.string().max(200).optional(),
  unit: z.string().max(20).optional(),
  labels: z.array(z.string().max(500)).max(100),
  values: z.array(z.number()).max(100),
})

const sectionSchema = z.object({
  heading: z.string().min(1).max(200),
  markdown: z.string().max(100_000).optional(),
  data: z.unknown().optional(),
  chart: chartSchema.optional(),
})

export const reportSaveInputSchema = z
  .object({
    site: z.string().min(1).describe('Site the report is about, e.g. example.com'),
    title: z.string().min(1).max(200),
    sections: z.array(sectionSchema).min(1).max(50).optional(),
    tool_output: z.unknown().optional(),
    template: z.string().optional(),
    section_data: z.record(z.string(), z.unknown()).optional(),
    intro: z.string().max(20_000).optional(),
    ...stateInputs,
  })
  .refine((d) => [d.sections !== undefined, d.tool_output !== undefined, d.template !== undefined].filter(Boolean).length === 1, {
    error: 'Pass exactly one of sections, tool_output or template',
  })

export type ReportSaveInput = z.infer<typeof reportSaveInputSchema>

export type ReportSaveResult = ({ success: true } & ReportMeta & { path: string; not_run: string[] }) | ToolFailureResult

/** Fill a template's sections from section_data; unfilled ones become "not run" notices. */
export function fillTemplate(template: ListedTemplate, sectionData: Record<string, unknown> = {}): ReportSection[] {
  return template.sections.map((ts) => {
    if (!(ts.heading in sectionData) || sectionData[ts.heading] === undefined) {
      return { heading: ts.heading, not_run: { tool: ts.tool, instructions: ts.instructions } }
    }
    const value = sectionData[ts.heading]
    return typeof value === 'string' ? { heading: ts.heading, markdown: value } : { heading: ts.heading, data: value }
  })
}

export function runReportSave(input: ReportSaveInput, now: Date = new Date()): ReportSaveResult {
  try {
    const store = storeFor(input)
    const site = siteKey(input.site)

    let sections: ReportSection[]
    let templateName: string | null = null
    if (input.template !== undefined) {
      const template = findTemplate(store.dir, input.template, site)
      if (!template) {
        return errorResult(ErrorCode.NOT_FOUND, `No report template named "${input.template}".`, 'List them with report_template_list.')
      }
      templateName = template.name
      const known = new Set(template.sections.map((s) => s.heading))
      const unknown = Object.keys(input.section_data ?? {}).filter((h) => !known.has(h))
      if (unknown.length) {
        return errorResult(
          ErrorCode.INVALID_INPUT,
          `section_data has headings the template "${template.name}" does not define: ${unknown.join(', ')}.`,
          `Use the template's headings: ${[...known].join(', ')}.`,
        )
      }
      sections = fillTemplate(template, input.section_data)
    } else if (input.tool_output !== undefined) {
      sections = [{ heading: 'Result', data: input.tool_output }]
    } else {
      sections = (input.sections ?? []).map((s) => ({ heading: s.heading, markdown: s.markdown, data: s.data, chart: s.chart }))
    }
    if (input.intro) sections = [{ heading: 'Overview', markdown: input.intro }, ...sections]

    const id = newId(now)
    const html = renderReport({ title: input.title, site, generated_at: now.toISOString(), template: templateName, sections })
    const path = htmlPath(store, site, id)
    atomicWriteText(path, html)
    const meta: ReportMeta = {
      id,
      title: input.title,
      site,
      created_at: now.toISOString(),
      template: templateName,
      sections: summarize(sections),
      html_file: `${id}.html`,
      size_bytes: Buffer.byteLength(html, 'utf8'),
    }
    store.writeRecord(REPORTS_COLLECTION, site, id, meta, now)
    return {
      success: true,
      ...meta,
      path,
      not_run: sections.filter((s) => s.not_run).map((s) => s.heading),
    }
  } catch (err) {
    return fail(err)
  }
}

export const reportSaveTool = {
  name: 'report_save',
  description:
    'Use to save a shareable report: writes ONE self-contained HTML file (inline CSS, no scripts, no remote resources, light/dark, readable on phones) per site in the state dir. ' +
    'Pass exactly one of: `sections` [{heading, markdown?, data? (any tool output: arrays of objects become tables, objects become key/value tables), chart? {labels, values, title?, unit?}}]; ' +
    '`tool_output` (any JSON, rendered as one section); or `template` (see report_template_list) with `section_data` {heading: tool output or markdown string} — template sections you did not fill render a "not run" notice. ' +
    'Everything is HTML-escaped, so crawled or AI text cannot inject markup. Markdown supports headings, paragraphs, **bold**, *italic*, `code`, lists and http(s) links. ' +
    'Returns id, path (absolute path of the .html file to share), size_bytes and not_run headings. Local only: nothing is uploaded. Free.',
  inputSchema: {
    type: 'object',
    required: ['site', 'title'],
    properties: {
      site: { type: 'string', description: 'Site the report is about, e.g. "example.com" (also sc-domain: or a URL)' },
      title: { type: 'string', description: 'Report title (max 200 chars)' },
      sections: {
        type: 'array',
        description: 'Report sections, in order (max 50)',
        items: {
          type: 'object',
          required: ['heading'],
          properties: {
            heading: { type: 'string' },
            markdown: { type: 'string', description: 'Prose in safe markdown' },
            data: { description: 'Any JSON, e.g. a tool output; rendered as tables' },
            chart: {
              type: 'object',
              description: 'Horizontal bar chart',
              properties: {
                title: { type: 'string' },
                unit: { type: 'string' },
                labels: { type: 'array', items: { type: 'string' } },
                values: { type: 'array', items: { type: 'number' } },
              },
              required: ['labels', 'values'],
            },
          },
        },
      },
      tool_output: { type: ['object', 'array'], description: 'Any tool output (JSON object or array) to render as a single section' },
      template: { type: 'string', description: 'Template name, e.g. "monthly_seo_checkin"' },
      section_data: { type: 'object', description: 'With template: {section heading: tool output or markdown string}' },
      intro: { type: 'string', description: 'Optional overview paragraph(s) in markdown, shown first' },
      ...stateInputProps,
    },
  },
  annotations: { title: 'Save an HTML report', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}

export const reportSaveSpec = native({
  tool: reportSaveTool,
  schema: reportSaveInputSchema,
  run: async (input) => done(runReportSave(input)),
})

// ============================================================================
// report_list
// ============================================================================

export const reportListInputSchema = z.object({
  site: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional().default(50),
  ...stateInputs,
})

export type ReportListInput = z.infer<typeof reportListInputSchema>

export type ReportListResult =
  | { success: true; state_dir: string; total: number; reports: (ReportMeta & { path: string })[] }
  | ToolFailureResult

export function runReportList(input: ReportListInput): ReportListResult {
  try {
    const store = storeFor(input)
    const sites = input.site ? [siteKey(input.site)] : store.listSites(REPORTS_COLLECTION)
    const all: (ReportMeta & { path: string })[] = []
    for (const site of sites) {
      for (const id of store.listRecordIds(REPORTS_COLLECTION, site)) {
        const rec = store.readRecord<ReportMeta>(REPORTS_COLLECTION, site, id)
        if (rec) all.push({ ...rec.data, path: htmlPath(store, site, id) })
      }
    }
    all.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    return { success: true, state_dir: store.dir, total: all.length, reports: all.slice(0, input.limit) }
  } catch (err) {
    return fail(err)
  }
}

export const reportListTool = {
  name: 'report_list',
  description:
    'Use to find saved HTML reports: lists them newest first with id, title, site, created_at, template, section summary, size and the .html path. ' +
    'Filter by `site`; without it, lists every site in the state dir. Free, local.',
  inputSchema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'Only reports for this site' },
      limit: { type: 'number', description: 'Max reports (default 50, max 500)', default: 50 },
      ...stateInputProps,
    },
  },
  annotations: { title: 'List saved reports', readOnlyHint: true, openWorldHint: false },
}

export const reportListSpec = native({
  tool: reportListTool,
  schema: reportListInputSchema,
  run: async (input) => done(runReportList(input)),
})

// ============================================================================
// report_get
// ============================================================================

export const reportGetInputSchema = z.object({
  site: z.string().min(1),
  id: z.string().optional(),
  format: z.enum(['meta', 'path', 'html']).optional().default('meta'),
  ...stateInputs,
})

export type ReportGetInput = z.infer<typeof reportGetInputSchema>

export type ReportGetResult =
  | ({ success: true; format: 'meta' | 'path' | 'html'; path: string; html?: string } & ReportMeta)
  | ToolFailureResult

export function runReportGet(input: ReportGetInput): ReportGetResult {
  try {
    const store = storeFor(input)
    const site = siteKey(input.site)
    const id = input.id ?? store.listRecordIds(REPORTS_COLLECTION, site)[0]
    if (!id) return errorResult(ErrorCode.NOT_FOUND, `No saved reports for ${site}.`, 'Save one with report_save.')
    const rec = store.readRecord<ReportMeta>(REPORTS_COLLECTION, site, id)
    if (!rec) return errorResult(ErrorCode.NOT_FOUND, `No report "${id}" for ${site}.`, 'List them with report_list.')
    const path = htmlPath(store, site, id)
    const base = { success: true as const, format: input.format, path, ...rec.data }
    if (input.format !== 'html') return base
    let html: string
    try {
      html = readFileSync(path, 'utf8')
    } catch {
      return errorResult(ErrorCode.NOT_FOUND, `The HTML file for report "${id}" is missing: ${path}.`, 'Delete the record with report_delete and save it again.')
    }
    return { ...base, html }
  } catch (err) {
    return fail(err)
  }
}

export const reportGetTool = {
  name: 'report_get',
  description:
    'Use to open or share a saved report (newest for the site when `id` is omitted). format "meta" (default) returns metadata and the .html path; ' +
    '"path" the same, for scripts; "html" also returns the full self-contained HTML text, ready to publish or attach. ' +
    'Sharing is by file: send the .html file, or have the assistant publish the HTML. Nothing is uploaded by this tool. Free, local.',
  inputSchema: {
    type: 'object',
    required: ['site'],
    properties: {
      site: { type: 'string', description: 'Site the report belongs to' },
      id: { type: 'string', description: 'Report id (default: newest)' },
      format: { type: 'string', enum: ['meta', 'path', 'html'], description: 'What to return (default "meta")', default: 'meta' },
      ...stateInputProps,
    },
  },
  annotations: { title: 'Get a saved report', readOnlyHint: true, openWorldHint: false },
}

export const reportGetSpec = native({
  tool: reportGetTool,
  schema: reportGetInputSchema,
  run: async (input) => done(runReportGet(input)),
})

// ============================================================================
// report_delete
// ============================================================================

export const reportDeleteInputSchema = z.object({
  site: z.string().min(1),
  id: z.string().min(1),
  ...stateInputs,
})

export type ReportDeleteInput = z.infer<typeof reportDeleteInputSchema>

export type ReportDeleteResult = { success: true; deleted: boolean; id: string; site: string } | ToolFailureResult

export function runReportDelete(input: ReportDeleteInput): ReportDeleteResult {
  try {
    const store = storeFor(input)
    const site = siteKey(input.site)
    const path = htmlPath(store, site, input.id)
    let hadHtml = false
    try {
      statSync(path)
      hadHtml = true
      rmSync(path, { force: true })
    } catch {
      hadHtml = false
    }
    const hadRecord = store.deleteRecord(REPORTS_COLLECTION, site, input.id)
    if (!hadRecord && !hadHtml) {
      return errorResult(ErrorCode.NOT_FOUND, `No report "${input.id}" for ${site}.`, 'List them with report_list.')
    }
    return { success: true, deleted: true, id: input.id, site }
  } catch (err) {
    return fail(err)
  }
}

export const reportDeleteTool = {
  name: 'report_delete',
  description: 'Use to delete a saved report: removes its metadata and its .html file from the local state dir. Cannot be undone. Free, local.',
  inputSchema: {
    type: 'object',
    required: ['site', 'id'],
    properties: {
      site: { type: 'string', description: 'Site the report belongs to' },
      id: { type: 'string', description: 'Report id (from report_list)' },
      ...stateInputProps,
    },
  },
  // Removes a local file only; no Google or third-party resource changes.
  annotations: { title: 'Delete a saved report', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const reportDeleteSpec = native({
  tool: reportDeleteTool,
  schema: reportDeleteInputSchema,
  run: async (input) => done(runReportDelete(input)),
})

// ============================================================================
// Templates
// ============================================================================

const templateSectionSchema = z.object({
  heading: z.string().min(1).max(200),
  instructions: z.string().min(1).max(2000),
  tool: z.string().regex(/^[a-z0-9_]+$/).optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
})

export const reportTemplateSaveInputSchema = z.object({
  name: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  sections: z.array(templateSectionSchema).min(1).max(50),
  site: z.string().optional(),
  ...stateInputs,
})

export type ReportTemplateSaveInput = z.infer<typeof reportTemplateSaveInputSchema>

export type ReportTemplateSaveResult =
  | { success: true; name: string; scope: 'global' | 'site'; site: string | null; created: boolean; sections: number }
  | ToolFailureResult

export function runReportTemplateSave(input: ReportTemplateSaveInput): ReportTemplateSaveResult {
  try {
    const store = storeFor(input)
    const headings = input.sections.map((s) => s.heading)
    if (new Set(headings).size !== headings.length) {
      return errorResult(ErrorCode.INVALID_INPUT, 'Template section headings must be unique (section_data is keyed by heading).')
    }
    const site = input.site ? siteKey(input.site) : undefined
    const { created } = saveTemplate(
      store.dir,
      { name: input.name, title: input.title, description: input.description, sections: input.sections },
      site,
    )
    return { success: true, name: input.name, scope: site ? 'site' : 'global', site: site ?? null, created, sections: input.sections.length }
  } catch (err) {
    return fail(err)
  }
}

export const reportTemplateSaveTool = {
  name: 'report_template_save',
  description:
    'Use to create or replace a reusable report template (e.g. a client\'s monthly check-in): an ordered list of sections, each with a heading, ' +
    'instructions (what to run or write) and optionally the tool name and tool_input to run. Global by default; pass `site` to scope it to one site ' +
    '(a site template hides a global one with the same name). Built-in templates (monthly_seo_checkin) cannot be overwritten. Free, local.',
  inputSchema: {
    type: 'object',
    required: ['name', 'title', 'sections'],
    properties: {
      name: { type: 'string', description: 'Template name: lowercase letters, digits, "_" or "-"' },
      title: { type: 'string', description: 'Default report title' },
      description: { type: 'string', description: 'What the report is for' },
      sections: {
        type: 'array',
        description: 'Ordered sections; headings must be unique',
        items: {
          type: 'object',
          required: ['heading', 'instructions'],
          properties: {
            heading: { type: 'string' },
            instructions: { type: 'string', description: 'What the agent runs or writes for this section' },
            tool: { type: 'string', description: 'Tool to run, e.g. "gsc_analytics_run"' },
            tool_input: { type: 'object', description: 'Suggested input for that tool' },
          },
        },
      },
      site: { type: 'string', description: 'Scope the template to this site (default: global)' },
      ...stateInputProps,
    },
  },
  annotations: { title: 'Save a report template', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const reportTemplateSaveSpec = native({
  tool: reportTemplateSaveTool,
  schema: reportTemplateSaveInputSchema,
  run: async (input) => done(runReportTemplateSave(input)),
})

export const reportTemplateListInputSchema = z.object({
  site: z.string().optional(),
  ...stateInputs,
})

export type ReportTemplateListInput = z.infer<typeof reportTemplateListInputSchema>

export type ReportTemplateListResult = { success: true; templates: ListedTemplate[] } | ToolFailureResult

export function runReportTemplateList(input: ReportTemplateListInput): ReportTemplateListResult {
  try {
    const store = storeFor(input)
    return { success: true, templates: listTemplates(store.dir, input.site ? siteKey(input.site) : undefined) }
  } catch (err) {
    return fail(err)
  }
}

export const reportTemplateListTool = {
  name: 'report_template_list',
  description:
    'Use before report_save with `template`: lists report templates with their sections (heading, instructions, tool, tool_input). ' +
    'Includes the built-in monthly_seo_checkin (organic traffic, top queries, page opportunities, audit issues, rankings, AI visibility, research log, summary), ' +
    'global templates, and with `site` that site\'s templates. Run each section\'s tool, then pass the outputs to report_save as section_data keyed by heading. Free, local.',
  inputSchema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'Also include templates scoped to this site' },
      ...stateInputProps,
    },
  },
  annotations: { title: 'List report templates', readOnlyHint: true, openWorldHint: false },
}

export const reportTemplateListSpec = native({
  tool: reportTemplateListTool,
  schema: reportTemplateListInputSchema,
  run: async (input) => done(runReportTemplateList(input)),
})

export const reportTemplateDeleteInputSchema = z.object({
  name: z.string().min(1),
  site: z.string().optional(),
  ...stateInputs,
})

export type ReportTemplateDeleteInput = z.infer<typeof reportTemplateDeleteInputSchema>

export type ReportTemplateDeleteResult = { success: true; deleted: true; name: string; scope: 'global' | 'site' } | ToolFailureResult

export function runReportTemplateDelete(input: ReportTemplateDeleteInput): ReportTemplateDeleteResult {
  try {
    const store = storeFor(input)
    const site = input.site ? siteKey(input.site) : undefined
    if (!deleteTemplate(store.dir, input.name, site)) {
      return errorResult(
        ErrorCode.NOT_FOUND,
        `No ${site ? `template "${input.name}" for ${site}` : `global template "${input.name}"`}.`,
        'List them with report_template_list (pass site for site templates).',
      )
    }
    return { success: true, deleted: true, name: input.name, scope: site ? 'site' : 'global' }
  } catch (err) {
    return fail(err)
  }
}

export const reportTemplateDeleteTool = {
  name: 'report_template_delete',
  description: 'Use to delete a saved report template (global, or the site\'s when `site` is given). Built-in templates cannot be deleted. Saved reports are kept. Free, local.',
  inputSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Template name' },
      site: { type: 'string', description: 'Delete the site-scoped template instead of the global one' },
      ...stateInputProps,
    },
  },
  annotations: { title: 'Delete a report template', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

export const reportTemplateDeleteSpec = native({
  tool: reportTemplateDeleteTool,
  schema: reportTemplateDeleteInputSchema,
  run: async (input) => done(runReportTemplateDelete(input)),
})
