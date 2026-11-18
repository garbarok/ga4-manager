import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { gatePaidRun, gateSchemaProperties, gateZodShape, type CostEstimate, type PlannedRequest } from '../utils/paid-gate.js'
import { marketProperties, marketShape, marketTask } from '../utils/market.js'
import { guard, storeFor } from '../utils/site-input.js'
import { siteKey } from '../utils/state-store.js'
import { setContextSite } from '../utils/tool-context.js'
import { resolveConfigs } from '../utils/config-resolve.js'
import { querySearchAnalytics } from './gsc-traffic-compare.js'
import { loadWorkspace } from './keyword-workspace.js'
import { normalizeKeyword } from './rank-tracker-core.js'

/**
 * Suggested keywords for a site (OpenSEO get_suggested_keywords).
 *
 * Free part: Search Console queries the site already ranks for on positions
 * 4–30 (striking distance) with enough impressions, that are not yet in the
 * saved keyword workspace. Optional paid part (include_paid): DataForSEO Labs
 * keywords_for_site, the keywords DataForSEO associates with the domain.
 */

export const KEYWORDS_FOR_SITE_PATH = 'dataforseo_labs/google/keywords_for_site/live'
const GSC_LAG_DAYS = 3

export const keywordSuggestionsSchema = z
  .object({
    site: z.string().optional(),
    config: z.string().optional(),
    state_dir: z.string().optional(),
    days: z.number().int().min(7).max(480).optional().default(90),
    min_position: z.number().min(1).max(100).optional().default(4),
    max_position: z.number().min(1).max(100).optional().default(30),
    min_impressions: z.number().int().min(0).optional().default(10),
    limit: z.number().int().min(1).max(500).optional().default(50),
    include_paid: z.boolean().optional().default(false),
    paid_limit: z.number().int().min(1).max(1000).optional().default(50),
    ...marketShape,
    ...gateZodShape(0.5),
  })
  .refine((d) => d.site || d.config, { error: 'Pass site or config' })
  .refine((d) => d.min_position <= d.max_position, { error: 'min_position must be <= max_position' })

export type KeywordSuggestionsInput = z.infer<typeof keywordSuggestionsSchema>

interface GscQueryRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscSuggestion {
  keyword: string
  position: number
  impressions: number
  clicks: number
  ctr: number
}

export interface PaidSuggestion {
  keyword: string
  search_volume: number | null
  keyword_difficulty: number | null
  cpc: number | null
  intent: string | null
  in_gsc: boolean
}

interface KeywordsForSiteItem {
  keyword?: string | null
  keyword_info?: { search_volume?: number | null; cpc?: number | null } | null
  keyword_properties?: { keyword_difficulty?: number | null } | null
  search_intent_info?: { main_intent?: string | null } | null
}

/** sc-domain: and URL-prefix sites pass through; a bare domain becomes a domain property. */
export function gscSiteFor(site: string): string {
  const s = site.trim()
  if (/^sc-domain:/i.test(s) || /^https?:\/\//i.test(s)) return s
  return `sc-domain:${siteKey(s)}`
}

export function gscWindow(days: number, today: Date = new Date()): { start: string; end: string } {
  const end = new Date(today.getTime() - GSC_LAG_DAYS * 86_400_000)
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export function pickGscSuggestions(rows: GscQueryRow[], saved: Set<string>, input: Pick<KeywordSuggestionsInput, 'min_position' | 'max_position' | 'min_impressions' | 'limit'>): GscSuggestion[] {
  return rows
    .map((r) => ({ keyword: normalizeKeyword(r.keys[0] ?? ''), position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr }))
    .filter((r) => r.keyword && !saved.has(r.keyword))
    .filter((r) => r.position >= input.min_position && r.position <= input.max_position && r.impressions >= input.min_impressions)
    .sort((a, b) => b.impressions - a.impressions || a.position - b.position)
    .slice(0, input.limit)
    .map((r) => ({ ...r, position: Math.round(r.position * 10) / 10, ctr: Math.round(r.ctr * 10000) / 10000 }))
}

export function mapPaid(items: KeywordsForSiteItem[], saved: Set<string>, gsc: Set<string>): PaidSuggestion[] {
  return items
    .filter((i) => i.keyword)
    .map((i) => ({
      keyword: normalizeKeyword(i.keyword as string),
      search_volume: i.keyword_info?.search_volume ?? null,
      keyword_difficulty: i.keyword_properties?.keyword_difficulty ?? null,
      cpc: i.keyword_info?.cpc ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
      in_gsc: gsc.has(normalizeKeyword(i.keyword as string)),
    }))
    .filter((i) => !saved.has(i.keyword))
}

export function planKeywordsForSite(domain: string, input: KeywordSuggestionsInput): PlannedRequest {
  return {
    path: KEYWORDS_FOR_SITE_PATH,
    task: { target: domain, ...marketTask(input), limit: input.paid_limit, include_subdomains: true, order_by: ['keyword_info.search_volume,desc'] },
    expected_results: input.paid_limit,
  }
}

export async function runKeywordSuggestions(input: KeywordSuggestionsInput, executor: CLIExecutor, today: Date = new Date()) {
  return guard(async () => {
    let gscSite: string
    if (input.config) {
      const [cfg] = await resolveConfigs(executor, { config: input.config })
      if (!cfg?.gsc_site) throw new ToolError(ErrorCode.INVALID_INPUT, `No search_console.site_url in ${input.config}.`)
      gscSite = cfg.gsc_site
    } else gscSite = gscSiteFor(input.site as string)
    const domain = siteKey(gscSite)
    setContextSite(domain)

    const store = storeFor(input)
    const saved = new Set(loadWorkspace(store, domain).keywords.map((k) => k.keyword))
    const window = gscWindow(input.days, today)
    const warnings: string[] = []

    let gsc: GscSuggestion[] = []
    let gscError: unknown = null
    try {
      const rows = (await querySearchAnalytics(gscSite, window.start, window.end, ['query'], 25000)) as unknown as GscQueryRow[]
      gsc = pickGscSuggestions(rows, saved, input)
    } catch (err) {
      gscError = err
      if (!input.include_paid) throw err
      warnings.push(`Search Console failed, showing paid suggestions only: ${err instanceof Error ? err.message : String(err)}`)
    }

    let paid: PaidSuggestion[] | null = null
    let estimate: CostEstimate | null = null
    let cost: number | null = 0
    if (input.include_paid) {
      const plan = planKeywordsForSite(domain, input)
      const gate = await gatePaidRun([plan], { max_cost_usd: input.max_cost_usd, estimate_only: input.estimate_only })
      if (!gate.proceed) {
        if (!gate.output.success) return gate.output
        return { ...gate.output, gsc_suggestions: gscError ? null : gsc, gsc_window: window }
      }
      estimate = gate.estimate
      const res = await dataforseoRequest<{ items?: KeywordsForSiteItem[] | null }>({ path: plan.path, task: plan.task })
      paid = mapPaid(res.items[0]?.items ?? [], saved, new Set(gsc.map((g) => g.keyword)))
      cost = res.cost
    }
    if (!gscError && gsc.length === 0) {
      warnings.push(`No unsaved queries at positions ${input.min_position}–${input.max_position} with ≥${input.min_impressions} impressions in the last ${input.days} days.`)
    }

    return {
      success: true as const,
      site: domain,
      gsc_site: gscSite,
      gsc_window: window,
      already_saved: saved.size,
      gsc_suggestions: gscError ? null : gsc,
      paid_suggestions: paid,
      warnings,
      next_step: 'Save the ones worth targeting with keywords_save (add tags), then track them with rank_tracker_create.',
      estimate,
      cost_usd: cost,
    }
  })
}

export const keywordSuggestionsSpec = native({
  tool: {
    name: 'keyword_suggestions',
    description:
      'Use to find keywords worth adding to a site\'s keyword workspace (OpenSEO get_suggested_keywords). ' +
      'Free by default: Search Console queries the site already ranks for at positions 4–30 (striking distance) with ≥ min_impressions, not yet saved, by impressions. ' +
      'include_paid: true adds DataForSEO Labs keywords_for_site (keywords associated with the domain, with volume, difficulty, CPC, intent; gated by max_cost_usd, default $0.5). ' +
      'Needs Search Console access for the site (site or config).',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'sc-domain:example.com, https://example.com/ or example.com (treated as a domain property)' },
        config: { type: 'string', description: 'Site config path (alternative to site; state kept next to it)' },
        state_dir: { type: 'string', description: 'Override the state directory' },
        days: { type: 'number', description: 'Search Console window in days, ending 3 days ago (default 90)', default: 90 },
        min_position: { type: 'number', description: 'Lowest average position to include (default 4)', default: 4 },
        max_position: { type: 'number', description: 'Highest average position to include (default 30)', default: 30 },
        min_impressions: { type: 'number', description: 'Minimum impressions in the window (default 10)', default: 10 },
        limit: { type: 'number', description: 'Max Search Console suggestions (default 50)', default: 50 },
        include_paid: { type: 'boolean', description: 'Also buy DataForSEO keywords_for_site (default false)', default: false },
        paid_limit: { type: 'number', description: 'Paid suggestions to request (default 50)', default: 50 },
        ...marketProperties,
        ...gateSchemaProperties(0.5),
      },
    },
    annotations: { title: 'Suggested keywords for a site', readOnlyHint: true, openWorldHint: true },
  },
  schema: keywordSuggestionsSchema,
  run: async (input, executor) => {
    const output = await runKeywordSuggestions(input, executor)
    return { output, isError: (output as { success?: boolean }).success !== true }
  },
})
