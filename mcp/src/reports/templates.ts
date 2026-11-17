import { join } from 'node:path'
import { StateStore, atomicWriteJson, readEnvelope, siteKey, STATE_SCHEMA_VERSION, type StateEnvelope } from '../utils/state-store.js'
import { ToolError, ErrorCode } from '../utils/errors.js'

/**
 * Reusable report templates: an ordered list of sections, each saying which
 * tool to run (and with what input) or what to write. An agent runs the tools,
 * then calls report_save with `template` and the outputs in `section_data`.
 *
 * Storage (shared ADR-0005 envelope):
 *   - global:   <state_dir>/report-templates.json
 *   - per site: <state_dir>/report-templates.<site>.json
 * Built-in templates live in code and cannot be overwritten or deleted.
 */

export const TEMPLATE_COMMAND = 'report-templates'
export const GLOBAL_SCOPE = '_global'

export interface TemplateSection {
  heading: string
  /** What the agent should do for this section: which tool, which window, what to write. */
  instructions: string
  tool?: string
  tool_input?: Record<string, unknown>
}

export interface ReportTemplate {
  name: string
  title: string
  description: string
  sections: TemplateSection[]
}

export interface ListedTemplate extends ReportTemplate {
  scope: 'built_in' | 'global' | 'site'
  site?: string
  read_only: boolean
}

interface TemplateFile {
  templates: ReportTemplate[]
}

export const BUILT_IN_TEMPLATES: ReportTemplate[] = [
  {
    name: 'monthly_seo_checkin',
    title: 'Monthly SEO check-in',
    description:
      'A monthly organic-search check-in: traffic vs the previous period, top queries, pages to work on, site health, rankings, AI visibility and what was researched.',
    sections: [
      {
        heading: 'Organic traffic',
        tool: 'ga4_organic_overview',
        instructions:
          'Run ga4_organic_overview for the last 28 days with the previous-period comparison. Pass its output; lead with sessions, key events and the change vs the previous period.',
      },
      {
        heading: 'Top search queries',
        tool: 'gsc_analytics_run',
        tool_input: { days: 28, dimensions: 'query', limit: 25 },
        instructions: 'Run gsc_analytics_run for the top 25 queries over 28 days. Note data_through: the last day Search Console has data for.',
      },
      {
        heading: 'Page opportunities',
        tool: 'page_opportunities',
        instructions: 'Run page_opportunities and pass the scored pages (positions 4–20). Keep the coverage block so readers see how many pages matched GA4.',
      },
      {
        heading: 'Site audit issues',
        tool: 'site_audit_issues',
        instructions: 'Read the latest site audit with site_audit_issues (run site_audit_run first if there is none this month). Pass the issues grouped by severity.',
      },
      {
        heading: 'Rank tracking',
        tool: 'rank_tracker_get',
        instructions: 'Run rank_tracker_get for the site’s tracker (after a rank_tracker_run this month). Pass positions with their change since the previous run.',
      },
      {
        heading: 'AI visibility',
        tool: 'ai_visibility_trend',
        instructions: 'Run ai_visibility_trend for the saved prompt set. Pass brand mention and citation rates by model over time.',
      },
      {
        heading: 'Research this month',
        tool: 'project_context_get',
        instructions: 'Run project_context_get and pass the research_log entries from this month (paid lookups and their cost), so the next check-in does not buy them again.',
      },
      {
        heading: 'Summary and next steps',
        instructions: 'Write 3–5 markdown bullets: what changed, why it likely changed, and the one or two actions for next month.',
      },
    ],
  },
]

const BUILT_IN_BY_NAME = new Map(BUILT_IN_TEMPLATES.map((t) => [t.name, t]))

export function isBuiltIn(name: string): boolean {
  return BUILT_IN_BY_NAME.has(name)
}

export function validateTemplateName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `Invalid template name "${name}": use lowercase letters, digits, "_" or "-" (max 64).`)
  }
  return name
}

function templatePath(stateDir: string, site?: string): string {
  return site ? new StateStore(stateDir).snapshotPath(TEMPLATE_COMMAND, site) : join(stateDir, `${TEMPLATE_COMMAND}.json`)
}

function readTemplates(stateDir: string, site?: string): ReportTemplate[] {
  return readEnvelope<TemplateFile>(templatePath(stateDir, site))?.data.templates ?? []
}

function writeTemplates(stateDir: string, site: string | undefined, templates: ReportTemplate[], now: Date): void {
  const env: StateEnvelope<TemplateFile> = {
    schema_version: STATE_SCHEMA_VERSION,
    command: TEMPLATE_COMMAND,
    site: site ? siteKey(site) : GLOBAL_SCOPE,
    generated_at: now.toISOString(),
    data: { templates },
  }
  atomicWriteJson(templatePath(stateDir, site), env)
}

export function saveTemplate(stateDir: string, template: ReportTemplate, site?: string, now: Date = new Date()): { created: boolean } {
  validateTemplateName(template.name)
  if (isBuiltIn(template.name)) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `"${template.name}" is a built-in template and cannot be overwritten.`, 'Save it under another name.')
  }
  const existing = readTemplates(stateDir, site)
  const created = !existing.some((t) => t.name === template.name)
  const next = [...existing.filter((t) => t.name !== template.name), template].sort((a, b) => a.name.localeCompare(b.name))
  writeTemplates(stateDir, site, next, now)
  return { created }
}

export function deleteTemplate(stateDir: string, name: string, site?: string, now: Date = new Date()): boolean {
  if (isBuiltIn(name)) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `"${name}" is a built-in template and cannot be deleted.`)
  }
  const existing = readTemplates(stateDir, site)
  if (!existing.some((t) => t.name === name)) return false
  writeTemplates(stateDir, site, existing.filter((t) => t.name !== name), now)
  return true
}

/** Built-ins, then global, then site templates. A site template hides a global one with the same name. */
export function listTemplates(stateDir: string, site?: string): ListedTemplate[] {
  const out: ListedTemplate[] = BUILT_IN_TEMPLATES.map((t) => ({ ...t, scope: 'built_in', read_only: true }))
  const siteTemplates = site ? readTemplates(stateDir, site) : []
  const siteNames = new Set(siteTemplates.map((t) => t.name))
  for (const t of readTemplates(stateDir)) {
    if (!siteNames.has(t.name)) out.push({ ...t, scope: 'global', read_only: false })
  }
  for (const t of siteTemplates) out.push({ ...t, scope: 'site', site: siteKey(site!), read_only: false })
  return out
}

export function findTemplate(stateDir: string, name: string, site?: string): ListedTemplate | null {
  return listTemplates(stateDir, site).find((t) => t.name === name) ?? null
}
