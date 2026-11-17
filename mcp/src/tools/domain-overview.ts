import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, sumCosts } from '../utils/dataforseo-client.js'
import { ErrorCode, ToolError } from '../utils/errors.js'
import { gatePaidRun, gateSchemaProperties, gateZodShape, type PlannedRequest } from '../utils/paid-gate.js'
import { marketProperties, marketShape, marketTask } from '../utils/market.js'
import { guard } from '../utils/site-input.js'
import { siteKey } from '../utils/state-store.js'

/**
 * Domain overview (OpenSEO get_domain_overview): estimated organic traffic,
 * ranking keyword counts by position band, and the top pages by traffic,
 * from DataForSEO Labs domain_rank_overview + relevant_pages.
 */

export const DOMAIN_RANK_PATH = 'dataforseo_labs/google/domain_rank_overview/live'
export const RELEVANT_PAGES_PATH = 'dataforseo_labs/google/relevant_pages/live'

export const domainOverviewSchema = z
  .object({
    domain: z.string().optional(),
    site: z.string().optional(),
    state_dir: z.string().optional(),
    ...marketShape,
    include_pages: z.boolean().optional().default(true),
    pages_limit: z.number().int().min(1).max(100).optional().default(10),
    ...gateZodShape(0.5),
  })
  .refine((d) => d.domain || d.site, { error: 'Pass domain (or site)' })

export type DomainOverviewInput = z.infer<typeof domainOverviewSchema>

const BANDS = ['pos_1', 'pos_2_3', 'pos_4_10', 'pos_11_20', 'pos_21_30', 'pos_31_40', 'pos_41_50', 'pos_51_60', 'pos_61_70', 'pos_71_80', 'pos_81_90', 'pos_91_100'] as const

type BandMetrics = Partial<Record<(typeof BANDS)[number], number | null>> & {
  etv?: number | null
  count?: number | null
  estimated_paid_traffic_cost?: number | null
  is_new?: number | null
  is_up?: number | null
  is_down?: number | null
  is_lost?: number | null
}

interface RankOverviewItem {
  metrics?: { organic?: BandMetrics | null; paid?: BandMetrics | null } | null
}

interface RelevantPageItem {
  page_address?: string | null
  metrics?: { organic?: BandMetrics | null } | null
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function summarizeOverview(item: RankOverviewItem | undefined) {
  const o = item?.metrics?.organic ?? {}
  const p = item?.metrics?.paid ?? {}
  const bands = Object.fromEntries(BANDS.map((b) => [b, n(o[b])])) as Record<(typeof BANDS)[number], number>
  return {
    organic: {
      estimated_traffic: Math.round(n(o.etv)),
      keywords: n(o.count),
      traffic_value_usd: Math.round(n(o.estimated_paid_traffic_cost)),
      top_3: bands.pos_1 + bands.pos_2_3,
      top_10: bands.pos_1 + bands.pos_2_3 + bands.pos_4_10,
      positions: bands,
      movement: { new: n(o.is_new), up: n(o.is_up), down: n(o.is_down), lost: n(o.is_lost) },
    },
    paid: { estimated_traffic: Math.round(n(p.etv)), keywords: n(p.count) },
  }
}

export function summarizePages(items: RelevantPageItem[]) {
  return items
    .filter((i) => i.page_address)
    .map((i) => {
      const o = i.metrics?.organic ?? {}
      return {
        url: i.page_address as string,
        estimated_traffic: Math.round(n(o.etv)),
        keywords: n(o.count),
        top_3: n(o.pos_1) + n(o.pos_2_3),
        top_10: n(o.pos_1) + n(o.pos_2_3) + n(o.pos_4_10),
      }
    })
}

export function planDomainOverview(target: string, input: DomainOverviewInput): PlannedRequest[] {
  const market = marketTask(input)
  const plan: PlannedRequest[] = [{ path: DOMAIN_RANK_PATH, task: { target, ...market }, expected_results: 1 }]
  if (input.include_pages) {
    plan.push({
      path: RELEVANT_PAGES_PATH,
      task: { target, ...market, limit: input.pages_limit, order_by: ['metrics.organic.etv,desc'] },
      expected_results: input.pages_limit,
    })
  }
  return plan
}

export async function runDomainOverview(input: DomainOverviewInput) {
  return guard(async () => {
    const target = siteKey(input.domain ?? input.site ?? '')
    const plan = planDomainOverview(target, input)
    const gate = await gatePaidRun(plan, { max_cost_usd: input.max_cost_usd, estimate_only: input.estimate_only })
    if (!gate.proceed) return gate.output

    const [rank, pages] = await Promise.allSettled(plan.map((p) => dataforseoRequest<{ items?: unknown[] | null }>({ path: p.path, task: p.task })))
    if (rank.status === 'rejected') throw rank.reason instanceof Error ? rank.reason : new ToolError(ErrorCode.UPSTREAM_5XX, String(rank.reason))
    const overviewItem = rank.value.items[0]?.items?.[0] as RankOverviewItem | undefined
    const warnings: string[] = []
    if (!overviewItem) warnings.push(`DataForSEO has no ranking data for ${target} in this market.`)
    let topPages: ReturnType<typeof summarizePages> | null = null
    if (pages) {
      if (pages.status === 'fulfilled') topPages = summarizePages((pages.value.items[0]?.items ?? []) as RelevantPageItem[])
      else warnings.push(`Top pages failed: ${pages.reason instanceof Error ? pages.reason.message : String(pages.reason)}`)
    }
    return {
      success: true as const,
      domain: target,
      market: marketTask(input),
      ...summarizeOverview(overviewItem),
      top_pages: topPages,
      warnings,
      estimate: gate.estimate,
      cost_usd: sumCosts([rank.value.cost, pages?.status === 'fulfilled' ? pages.value.cost : null]),
    }
  })
}

export const domainOverviewSpec = native({
  tool: {
    name: 'domain_overview',
    description:
      'Use for a quick size-up of any domain (yours or a competitor\'s) in one market (OpenSEO get_domain_overview): estimated monthly organic traffic and its ad value, ' +
      'ranking keyword counts by position band (pos_1, pos_2_3, pos_4_10, pos_11_20 … pos_91_100, plus top_3/top_10), keyword movement (new/up/down/lost), and the top pages by estimated traffic. ' +
      'Paid, DataForSEO Labs (~$0.012 per request + per result); gated by max_cost_usd (default $0.5) and the balance; estimate_only shows the cost. ' +
      'Traffic is DataForSEO\'s model estimate, not measured visits; use GA4/GSC tools for your own site\'s real numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to size up, e.g. "example.com"' },
        site: { type: 'string', description: 'Alias of domain (also scopes the research log)' },
        state_dir: { type: 'string', description: 'Override the state directory (lookup cache, research log)' },
        ...marketProperties,
        include_pages: { type: 'boolean', description: 'Also fetch top pages by traffic (default true; one extra request)', default: true },
        pages_limit: { type: 'number', description: 'Top pages to return (default 10)', default: 10 },
        ...gateSchemaProperties(0.5),
      },
    },
    annotations: { title: 'Domain overview', readOnlyHint: true, openWorldHint: true },
  },
  schema: domainOverviewSchema,
  run: async (input) => {
    const output = await runDomainOverview(input)
    return { output, isError: (output as { success?: boolean }).success !== true }
  },
})
