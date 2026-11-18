import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { gatePaidRun, gateSchemaProperties, gateZodShape, type PlannedRequest } from '../utils/paid-gate.js'
import { marketProperties, marketShape, marketTask } from '../utils/market.js'
import { guard, storeFor } from '../utils/site-input.js'
import { siteKey } from '../utils/state-store.js'
import { loadContext } from '../utils/project-context-store.js'
import { normalizeKeyword } from './rank-tracker-core.js'
import { savedKeywords } from './keyword-workspace.js'

/**
 * SERP competitors (OpenSEO find_serp_competitors): the domains that rank
 * most across a keyword set, from DataForSEO Labs serp_competitors. The site
 * itself and competitors already in the project context are marked, and
 * unknown frequent rankers are suggested for the context.
 */

export const SERP_COMPETITORS_PATH = 'dataforseo_labs/google/serp_competitors/live'
const MAX_KEYWORDS = 200

export const serpCompetitorsSchema = z
  .object({
    site: z.string().optional(),
    config: z.string().optional(),
    state_dir: z.string().optional(),
    keywords: z.array(z.string().min(1)).max(MAX_KEYWORDS).optional(),
    tag: z.string().optional(),
    ...marketShape,
    limit: z.number().int().min(1).max(100).optional().default(20),
    include_subdomains: z.boolean().optional().default(true),
    ...gateZodShape(0.5),
  })
  .refine((d) => d.keywords?.length || (d.tag && d.site), { error: 'Pass keywords, or tag together with site (keywords saved with keywords_save)' })

export type SerpCompetitorsInput = z.infer<typeof serpCompetitorsSchema>

interface LabsCompetitor {
  domain?: string | null
  avg_position?: number | null
  median_position?: number | null
  rating?: number | null
  etv?: number | null
  keywords_count?: number | null
  visibility?: number | null
  relevant_serp_items?: number | null
  keywords_positions?: Record<string, number[]> | null
}

interface LabsCompetitorsResult {
  total_count?: number | null
  items?: LabsCompetitor[] | null
}

/** Platforms that rank for almost any topic; flagged so they are not suggested as competitors. */
export const PLATFORM_DOMAINS = [
  'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'linkedin.com', 'pinterest.com',
  'reddit.com', 'quora.com', 'wikipedia.org', 'medium.com', 'amazon.com', 'amazon.es', 'amazon.de', 'amazon.fr', 'amazon.co.uk',
  'ebay.com', 'ebay.es', 'ebay.de', 'play.google.com', 'apps.apple.com', 'google.com', 'maps.google.com', 'tripadvisor.com', 'yelp.com',
]

export function isPlatform(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, '')
  return PLATFORM_DOMAINS.some((p) => d === p || d.endsWith(`.${p}`)) || /^amazon\.|^ebay\./.test(d)
}

export interface CompetitorRow {
  domain: string
  keywords_count: number
  share_of_keywords: number
  avg_position: number | null
  median_position: number | null
  visibility: number | null
  etv: number | null
  is_site: boolean
  is_known_competitor: boolean
  /** Social, video, marketplace, app-store or reference site: ranks everywhere, rarely a business competitor. */
  is_platform: boolean
  /** Best position per keyword in the set. */
  best_positions: Record<string, number>
}

function round(n: number | null | undefined, d = 2): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null
}

export function mapCompetitors(items: LabsCompetitor[], keywordCount: number, site: string | null, known: Set<string>): CompetitorRow[] {
  return items
    .filter((i) => i.domain)
    .map((i) => {
      const domain = (i.domain as string).toLowerCase().replace(/^www\./, '')
      const best: Record<string, number> = {}
      for (const [kw, positions] of Object.entries(i.keywords_positions ?? {})) {
        if (positions?.length) best[kw] = Math.min(...positions)
      }
      const count = i.keywords_count ?? Object.keys(best).length
      const isSite = site !== null && (domain === site || domain.endsWith(`.${site}`))
      return {
        domain,
        keywords_count: count,
        share_of_keywords: keywordCount ? round(count / keywordCount, 3)! : 0,
        avg_position: round(i.avg_position),
        median_position: round(i.median_position),
        visibility: round(i.visibility, 4),
        etv: round(i.etv),
        is_site: isSite,
        is_known_competitor: !isSite && [...known].some((k) => domain === k || domain.endsWith(`.${k}`)),
        is_platform: isPlatform(domain),
        best_positions: best,
      }
    })
}

export function planSerpCompetitors(keywords: string[], input: SerpCompetitorsInput): PlannedRequest {
  return {
    path: SERP_COMPETITORS_PATH,
    task: {
      keywords,
      ...marketTask(input),
      limit: input.limit,
      include_subdomains: input.include_subdomains,
      item_types: ['organic'],
    },
    expected_results: input.limit,
  }
}

export async function runSerpCompetitors(input: SerpCompetitorsInput) {
  return guard(async () => {
    const site = input.site ? siteKey(input.site) : null
    const store = storeFor(input)
    let keywords = (input.keywords ?? []).map(normalizeKeyword).filter(Boolean)
    if (!keywords.length && input.tag && site) keywords = savedKeywords(store, site, input.tag)
    keywords = [...new Set(keywords)].slice(0, MAX_KEYWORDS)
    if (!keywords.length) throw new ToolError(ErrorCode.INVALID_INPUT, `No keywords to analyse${input.tag ? ` (no saved keyword has tag "${input.tag}")` : ''}.`)

    const plan = planSerpCompetitors(keywords, input)
    const gate = await gatePaidRun([plan], { max_cost_usd: input.max_cost_usd, estimate_only: input.estimate_only })
    if (!gate.proceed) return gate.output

    const { items, cost } = await dataforseoRequest<LabsCompetitorsResult>({ path: plan.path, task: plan.task })
    const known = new Set(site ? loadContext(store, site).competitors.map((c) => siteKey(c.domain)) : [])
    const rows = mapCompetitors(items[0]?.items ?? [], keywords.length, site, known)
    const suggestions = rows.filter((r) => !r.is_site && !r.is_known_competitor && !r.is_platform && r.share_of_keywords >= 0.2).slice(0, 5).map((r) => r.domain)
    const ownRow = rows.find((r) => r.is_site) ?? null
    return {
      success: true as const,
      site,
      keywords_analyzed: keywords.length,
      market: marketTask(input),
      competitors: rows,
      site_row: ownRow,
      suggested_competitors: suggestions,
      notes: [
        ...(site && !ownRow ? [`${site} is not among the top ${input.limit} domains for this keyword set.`] : []),
        ...(suggestions.length ? ['Add suggested_competitors to the project context (project_context_update) to track them.'] : []),
        ...(rows.length === 0 ? ['DataForSEO has no SERP data for these keywords in this market; try more or broader keywords.'] : []),
      ],
      estimate: gate.estimate,
      cost_usd: cost,
    }
  })
}

export const serpCompetitorsSpec = native({
  tool: {
    name: 'serp_competitors',
    description:
      'Use to find who you actually compete with in search: the domains that rank most often across a keyword set (OpenSEO find_serp_competitors). ' +
      'Pass keywords (max 200) or a tag from the saved keyword list (keywords_save). Paid, DataForSEO Labs (~$0.01 + per result); gated by max_cost_usd (default $0.5) and the balance; estimate_only shows the cost. ' +
      'Returns per domain: keywords_count and share_of_keywords, avg/median position, visibility, estimated traffic (etv), best position per keyword; ' +
      'marks the site itself and competitors already in the project context, and suggests frequent rankers to add.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Your site (to mark it in the results and read known competitors from its project context)' },
        config: { type: 'string', description: 'Site config path (state dir next to it)' },
        state_dir: { type: 'string', description: 'Override the state directory' },
        keywords: { type: 'array', items: { type: 'string' }, description: `Keyword set (max ${MAX_KEYWORDS})` },
        tag: { type: 'string', description: 'Use the saved keywords with this tag (needs site)' },
        ...marketProperties,
        limit: { type: 'number', description: 'Domains to return (default 20, max 100)', default: 20 },
        include_subdomains: { type: 'boolean', description: 'Count subdomains with their domain (default true)', default: true },
        ...gateSchemaProperties(0.5),
      },
    },
    annotations: { title: 'SERP competitors for a keyword set', readOnlyHint: true, openWorldHint: true },
  },
  schema: serpCompetitorsSchema,
  run: async (input) => {
    const output = await runSerpCompetitors(input)
    return { output, isError: (output as { success?: boolean }).success !== true }
  },
})
