import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { querySearchFiltered, prefixRegex, type GscFilter } from '../utils/gsc-query.js'
import { gscDataThroughOrThrow } from '../utils/gsc-data-through.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import { normalizeGscSite, normalizeGa4Property } from '../utils/url-normalize.js'
import { setContextSite } from '../utils/tool-context.js'
import { runGa4Annotations, ga4AnnotationsInputSchema, type ReportingDataAnnotation } from './ga4-annotations.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import type { GscRow } from './compute-traffic-diff.js'

/**
 * gsc_change_impact: did a change (new title, rewrite, migration, template
 * fix) move Search Console metrics? For each change it compares equal windows
 * before and after the change day, skipping the change day itself and stopping
 * at `data_through` so Search Console's reporting lag never reads as a drop.
 */

// ============================================================================
// Input
// ============================================================================

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')

export const changeSchema = z
  .object({
    url: z.string().url().optional().describe('One page, exactly as Search Console reports it'),
    prefix: z.string().min(1).optional().describe('Every page whose URL starts with this: a full URL (https://www.example.com/blog/) or a path (/blog/, any host of the property)'),
    changed_on: isoDate,
    label: z.string().min(1).max(200),
  })
  .refine((c) => !(c.url && c.prefix), { message: 'pass url or prefix, not both' })

export const gscChangeImpactInputSchema = z
  .object({
    site: z.string().min(1).optional(),
    config: z.string().min(1).optional(),
    changes: z.array(changeSchema).max(50).optional(),
    from_annotations: z.boolean().optional().default(false).describe('Read changes from GA4 annotations (property_id or the config\'s ga4.property_id)'),
    property_id: z.string().optional(),
    annotations_since: isoDate.optional(),
    window_days: z.number().int().min(3).max(90).optional().default(28),
    min_days: z.number().int().min(1).max(90).optional().default(7),
    clicks_threshold_pct: z.number().min(0).max(1000).optional().default(10),
    position_threshold: z.number().min(0).max(50).optional().default(1),
    min_impressions: z.number().int().min(0).optional().default(100),
  })
  .refine((d) => d.site || d.config, { message: 'pass site or config' })
  .refine((d) => (d.changes && d.changes.length > 0) || d.from_annotations, { message: 'pass changes, or from_annotations: true' })

export type GscChangeImpactInput = z.infer<typeof gscChangeImpactInputSchema>
export type ChangeInput = z.infer<typeof changeSchema>

// ============================================================================
// Pure parts
// ============================================================================

export type Verdict = 'too_early' | 'improved' | 'worse' | 'flat'

export interface Metrics {
  clicks: number
  impressions: number
  ctr: number | null
  /** Impression-weighted average position; null without impressions. */
  position: number | null
}

export interface Thresholds {
  window_days: number
  min_days: number
  clicks_threshold_pct: number
  position_threshold: number
  min_impressions: number
}

const DAY = 86_400_000
const toMs = (d: string): number => Date.parse(`${d}T00:00:00Z`)
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * Equal before/after windows around a change. The change day is in neither.
 * The after window ends at data_through; both windows shrink to the days
 * available after the change (at most window_days).
 */
export function changeWindows(changedOn: string, dataThrough: string, windowDays: number): { days: number; before: { start: string; end: string }; after: { start: string; end: string } } {
  const change = toMs(changedOn)
  const available = Math.round((toMs(dataThrough) - change) / DAY)
  const days = Math.max(0, Math.min(windowDays, available))
  return {
    days,
    before: { start: iso(change - days * DAY), end: iso(change - DAY) },
    after: { start: iso(change + DAY), end: iso(change + days * DAY) },
  }
}

export function sumMetrics(rows: GscRow[]): Metrics {
  let clicks = 0
  let impressions = 0
  let weightedPos = 0
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
    weightedPos += r.position * r.impressions
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? Math.round((clicks / impressions) * 10_000) / 10_000 : null,
    position: impressions ? Math.round((weightedPos / impressions) * 100) / 100 : null,
  }
}

const pct = (after: number, before: number): number | null => (before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null)

export interface Delta {
  clicks: number
  clicks_pct: number | null
  impressions: number
  impressions_pct: number | null
  /** CTR change in percentage points. */
  ctr_pp: number | null
  /** Positive = moved down (worse). */
  position: number | null
}

export function delta(before: Metrics, after: Metrics): Delta {
  return {
    clicks: after.clicks - before.clicks,
    clicks_pct: pct(after.clicks, before.clicks),
    impressions: after.impressions - before.impressions,
    impressions_pct: pct(after.impressions, before.impressions),
    ctr_pp: before.ctr !== null && after.ctr !== null ? Math.round((after.ctr - before.ctr) * 10_000) / 100 : null,
    position: before.position !== null && after.position !== null ? Math.round((after.position - before.position) * 100) / 100 : null,
  }
}

/**
 * Clicks decide first: a change of ±clicks_threshold_pct is improved/worse.
 * When clicks moved less (or there were none before), position decides: a
 * move of ±position_threshold places. Otherwise flat.
 */
export function verdictFor(days: number, before: Metrics, after: Metrics, d: Delta, t: Thresholds): { verdict: Verdict; reason: string } {
  if (days < t.min_days) {
    return { verdict: 'too_early', reason: `Only ${days} day(s) of data after the change; at least ${t.min_days} are needed.` }
  }
  if (before.impressions + after.impressions < t.min_impressions) {
    return { verdict: 'too_early', reason: `Only ${before.impressions + after.impressions} impressions across both windows; at least ${t.min_impressions} are needed to judge.` }
  }
  const clicksBasis = before.clicks > 0 ? d.clicks_pct : null
  if (clicksBasis !== null && clicksBasis >= t.clicks_threshold_pct) return { verdict: 'improved', reason: `Clicks ${clicksBasis > 0 ? '+' : ''}${clicksBasis}% (threshold ±${t.clicks_threshold_pct}%).` }
  if (clicksBasis !== null && clicksBasis <= -t.clicks_threshold_pct) return { verdict: 'worse', reason: `Clicks ${clicksBasis}% (threshold ±${t.clicks_threshold_pct}%).` }
  if (d.position !== null && d.position <= -t.position_threshold) return { verdict: 'improved', reason: `Average position up ${Math.abs(d.position)} places (threshold ${t.position_threshold}); clicks within ±${t.clicks_threshold_pct}%.` }
  if (d.position !== null && d.position >= t.position_threshold) return { verdict: 'worse', reason: `Average position down ${d.position} places (threshold ${t.position_threshold}); clicks within ±${t.clicks_threshold_pct}%.` }
  return { verdict: 'flat', reason: `Clicks within ±${t.clicks_threshold_pct}% and position within ±${t.position_threshold}.` }
}

/** Changes from GA4 annotations. A URL or /path in the description scopes it; else site-wide. */
export function changesFromAnnotations(annotations: ReportingDataAnnotation[]): ChangeInput[] {
  const out: ChangeInput[] = []
  for (const a of annotations) {
    if (a.systemGenerated) continue
    const d = a.annotationDate ?? a.annotationDateRange?.startDate
    if (!d) continue
    const changed_on = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
    const text = `${a.title} ${a.description ?? ''}`
    const url = text.match(/https?:\/\/[^\s)"']+/)?.[0]
    const path = url ? null : text.match(/(?:^|\s)(\/[^\s)"']*)/)?.[1]
    const scope = url ? { prefix: url } : path ? { prefix: path } : {}
    out.push({ changed_on, label: a.title, ...scope })
  }
  return out
}

// ============================================================================
// Handler
// ============================================================================

export interface ChangeImpact {
  label: string
  changed_on: string
  scope: { type: 'url' | 'prefix' | 'site'; value: string | null }
  days_per_window: number
  windows: { before: { start: string; end: string }; after: { start: string; end: string } } | null
  before: Metrics | null
  after: Metrics | null
  delta: Delta | null
  verdict: Verdict
  reason: string
  overlapping_changes: string[]
}

export type GscChangeImpactResult =
  | {
      success: true
      site: string
      data_through: string
      thresholds: Thresholds
      notes: string[]
      changes: ChangeImpact[]
      quota_used: number
      warnings: string[]
    }
  | ToolFailureResult

function scopeFilter(c: ChangeInput): { scope: ChangeImpact['scope']; filters: GscFilter[] } {
  if (c.url) return { scope: { type: 'url', value: c.url }, filters: [{ dimension: 'page', operator: 'equals', expression: c.url }] }
  if (c.prefix) {
    // A bare path matches on any host of the property (apex, www, subdomains).
    const expression = c.prefix.startsWith('/') ? `^https?://[^/]+${prefixRegex(c.prefix).slice(1)}` : prefixRegex(c.prefix)
    return { scope: { type: 'prefix', value: c.prefix }, filters: [{ dimension: 'page', operator: 'includingRegex', expression }] }
  }
  return { scope: { type: 'site', value: null }, filters: [] }
}

export async function runGscChangeImpact(input: GscChangeImpactInput, executor: CLIExecutor, now: Date = new Date()): Promise<GscChangeImpactResult> {
  try {
    let site = input.site
    let propertyId = input.property_id
    if (input.config) {
      const [cfg] = await resolveConfigs(executor, { config: input.config })
      site = site ?? cfg?.gsc_site
      propertyId = propertyId ?? cfg?.property_id
    }
    if (!site) throw new ToolError(ErrorCode.INVALID_INPUT, 'No Search Console site in the config; pass site.')
    site = normalizeGscSite(site).site
    setContextSite(site)
    const warnings: string[] = []

    const changes: ChangeInput[] = [...(input.changes ?? [])]
    if (input.from_annotations) {
      if (!propertyId) throw new ToolError(ErrorCode.INVALID_INPUT, 'from_annotations needs property_id or a config with ga4.property_id.')
      const listed = await runGa4Annotations(
        ga4AnnotationsInputSchema.parse({ action: 'list', property: normalizeGa4Property(propertyId), ...(input.annotations_since ? { since: input.annotations_since } : {}) }),
      )
      if (!listed.success) return listed
      if (listed.action === 'list') {
        const fromNotes = changesFromAnnotations(listed.annotations)
        if (fromNotes.length === 0) warnings.push('No user-created GA4 annotations found in the window.')
        changes.push(...fromNotes)
      }
    }
    if (changes.length === 0) throw new ToolError(ErrorCode.INVALID_INPUT, 'No changes to evaluate.')

    const dataThrough = await gscDataThroughOrThrow(site, now)
    if (!dataThrough) {
      throw new ToolError(ErrorCode.NOT_FOUND, `Search Console has no data for ${site} in the last 14 days.`, 'Check the site format (sc-domain:example.com or https://example.com/) and that it receives impressions.')
    }
    const thresholds: Thresholds = {
      window_days: input.window_days,
      min_days: input.min_days,
      clicks_threshold_pct: input.clicks_threshold_pct,
      position_threshold: input.position_threshold,
      min_impressions: input.min_impressions,
    }

    let quota = 1
    const results: ChangeImpact[] = []
    for (const c of changes) {
      const { scope, filters } = scopeFilter(c)
      const w = changeWindows(c.changed_on, dataThrough, input.window_days)
      const overlapping = changes
        .filter((o) => o !== c && w.days > 0 && o.changed_on >= w.before.start && o.changed_on <= w.after.end)
        .map((o) => `${o.changed_on} ${o.label}`)
      if (w.days < input.min_days) {
        results.push({
          label: c.label,
          changed_on: c.changed_on,
          scope,
          days_per_window: w.days,
          windows: w.days > 0 ? { before: w.before, after: w.after } : null,
          before: null,
          after: null,
          delta: null,
          ...verdictFor(w.days, sumMetrics([]), sumMetrics([]), delta(sumMetrics([]), sumMetrics([])), thresholds),
          overlapping_changes: overlapping,
        })
        continue
      }
      const [beforeRows, afterRows] = await Promise.all([
        querySearchFiltered(site, { startDate: w.before.start, endDate: w.before.end, dimensions: ['date'], filters }),
        querySearchFiltered(site, { startDate: w.after.start, endDate: w.after.end, dimensions: ['date'], filters }),
      ])
      quota += 2
      const before = sumMetrics(beforeRows)
      const after = sumMetrics(afterRows)
      const d = delta(before, after)
      results.push({
        label: c.label,
        changed_on: c.changed_on,
        scope,
        days_per_window: w.days,
        windows: { before: w.before, after: w.after },
        before,
        after,
        delta: d,
        ...verdictFor(w.days, before, after, d, thresholds),
        overlapping_changes: overlapping,
      })
    }
    if (results.some((r) => r.overlapping_changes.length > 0)) {
      warnings.push('Some changes fall inside another change\'s windows; their effects cannot be separated.')
    }

    return {
      success: true,
      site,
      data_through: dataThrough,
      thresholds,
      notes: [
        'Windows are equal length; the change day is in neither window; the after window ends at data_through, so Search Console\'s 2–3 day lag is never counted as a drop.',
        'Seasonality and other changes are not controlled for: compare with an unchanged section, or with gsc_traffic_compare, before attributing a move to the change.',
      ],
      changes: results,
      quota_used: quota,
      warnings,
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscChangeImpactTool = {
  name: 'gsc_change_impact',
  description:
    'Use to judge whether a site change worked (new titles, a rewrite, a migration, a template fix): for each change {url or prefix (or the whole site), changed_on, label} ' +
    '— or every GA4 annotation with from_annotations: true — compares clicks, impressions, CTR and position over equal windows before and after the change day ' +
    '(the change day skipped, the after window ending at data_through so Search Console lag never looks like a drop). ' +
    'Returns days per window, both windows, deltas, and a verdict too_early / improved / worse / flat with the thresholds used (clicks ±10% first, then position ±1; min 7 days and 100 impressions). Free: 1 + 2 per change Search Console queries.',
  inputSchema: {
    type: 'object',
    properties: {
      site: { type: 'string', description: 'GSC site: sc-domain:example.com or https://example.com/' },
      config: { type: 'string', description: 'YAML config (search_console.site_url; ga4.property_id for from_annotations)' },
      changes: {
        type: 'array',
        description: 'Changes to evaluate: {url? | prefix?, changed_on: "YYYY-MM-DD", label}. Neither url nor prefix = the whole site.',
        items: {
          type: 'object',
          required: ['changed_on', 'label'],
          properties: {
            url: { type: 'string' },
            prefix: { type: 'string', description: 'Full URL prefix, or a /path that matches any host of the property' },
            changed_on: { type: 'string' },
            label: { type: 'string' },
          },
        },
      },
      from_annotations: { type: 'boolean', description: 'Also read changes from GA4 annotations; a URL or /path in the annotation text scopes it (default false)', default: false },
      property_id: { type: 'string', description: 'GA4 property for from_annotations' },
      annotations_since: { type: 'string', description: 'Only annotations on or after YYYY-MM-DD' },
      window_days: { type: 'number', description: 'Days per window, at most (default 28)', default: 28 },
      min_days: { type: 'number', description: 'Fewer days after the change → too_early (default 7)', default: 7 },
      clicks_threshold_pct: { type: 'number', description: 'Clicks change that counts as improved/worse (default 10)', default: 10 },
      position_threshold: { type: 'number', description: 'Position change that counts when clicks are flat (default 1)', default: 1 },
      min_impressions: { type: 'number', description: 'Fewer impressions across both windows → too_early (default 100)', default: 100 },
    },
  },
  annotations: { title: 'Search Console change impact', readOnlyHint: true, openWorldHint: true },
}

export const gscChangeImpactSpec = native({
  tool: gscChangeImpactTool,
  schema: gscChangeImpactInputSchema,
  run: async (input, executor) => {
    const output = await runGscChangeImpact(input, executor)
    return { output, isError: !output.success }
  },
})
