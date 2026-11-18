import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, sumCosts } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import { estimatePlan, gatePaidRun, gateSchemaProperties, gateZodShape, type CostEstimate, type EstimateOnlyResult } from '../utils/paid-gate.js'
import { siteStateProperties, siteStateShape, storeFor, guard } from '../utils/site-input.js'
import { siteKey, newId, type StateStore } from '../utils/state-store.js'
import {
  MAX_TRACKER_KEYWORDS, RUNS, SERP_PATH, TRACKERS,
  applyKeywordOps, buildHistory, compareRuns, latestRun, listRuns, listTrackers, loadTracker, newTracker,
  parseSerpForSite, planRun, saveTracker, serpTask, sortKeywords,
  type KeywordRank, type RankRun, type RunComparison, type SerpItem, type Tracker,
} from './rank-tracker-core.js'

/**
 * Rank tracker (OpenSEO create_rank_tracker / add/remove/pin keywords /
 * estimate_rank_tracker_cost / run_rank_tracker / get_rank_tracker /
 * get_rank_history). Trackers and runs are local state (ADR-0006); a run
 * buys one live Google SERP per keyword from DataForSEO behind the cost gate.
 * Scheduling stays outside the tool: run `ga4m rank-tracker-run` from cron.
 */

const CONCURRENCY = 5

const keywordList = z.array(z.string().min(1)).max(MAX_TRACKER_KEYWORDS)

function trackerNotFound(site: string, id: string | undefined, available: Tracker[]): ToolError {
  return new ToolError(
    id ? ErrorCode.NOT_FOUND : ErrorCode.INVALID_INPUT,
    id ? `No rank tracker "${id}" for ${site}.` : `${site} has ${available.length} rank trackers; pass tracker_id.`,
    available.length
      ? `Trackers: ${available.map((t) => `${t.id} (${t.name})`).join(', ')}`
      : 'Create one with rank_tracker_create.',
  )
}

/** The tracker named by id, or the site's only tracker when id is omitted. */
export function resolveTracker(store: StateStore, site: string, id?: string): Tracker {
  const key = siteKey(site)
  if (id) {
    const t = loadTracker(store, key, id)
    if (!t) throw trackerNotFound(key, id, listTrackers(store, key))
    return t
  }
  const all = listTrackers(store, key)
  if (all.length === 1) return all[0]
  throw trackerNotFound(key, undefined, all)
}

function market(t: Tracker) {
  return { location_code: t.location_code, location_name: t.location_name, language_code: t.language_code, device: t.device, depth: t.depth }
}

const trackerIdProp = { type: 'string', description: 'Tracker id (optional when the site has exactly one tracker)' }

// ============================================================================
// rank_tracker_create
// ============================================================================

export const rankTrackerCreateSchema = z
  .object({
    ...siteStateShape,
    name: z.string().optional(),
    keywords: keywordList.min(1),
    pinned: z.array(z.string().min(1)).optional(),
    location_code: z.number().int().positive().optional(),
    location_name: z.string().optional(),
    language_code: z.string().min(2).optional().default('en'),
    device: z.enum(['desktop', 'mobile']).optional().default('desktop'),
    depth: z.number().int().min(10).max(100).optional().default(100),
  })

export async function runRankTrackerCreate(input: z.infer<typeof rankTrackerCreateSchema>, now = new Date()) {
  return guard(() => {
    const store = storeFor(input)
    const tracker = newTracker(input, now)
    saveTracker(store, tracker)
    return { success: true as const, tracker, state_dir: store.dir }
  })
}

export const rankTrackerCreateSpec = native({
  tool: {
    name: 'rank_tracker_create',
    description:
      'Use to start tracking Google rankings for a set of keywords on one site, market and device. ' +
      'Stores the tracker locally (.ga4-state/); nothing is bought until rank_tracker_run. ' +
      'Market: location_code (see serp_locations) or location_name, plus language_code; device desktop|mobile; depth = results scanned (10–100, billed per 10). ' +
      'Returns the tracker with its id. Then: rank_tracker_estimate → rank_tracker_run (schedule with cron: ga4m rank-tracker-run --site example.com --tracker-id <id>).',
    inputSchema: {
      type: 'object',
      required: ['site', 'keywords'],
      properties: {
        ...siteStateProperties,
        name: { type: 'string', description: 'Display name (default "<site> <device>")' },
        keywords: { type: 'array', items: { type: 'string' }, description: `Keywords to track (max ${MAX_TRACKER_KEYWORDS})` },
        pinned: { type: 'array', items: { type: 'string' }, description: 'Keywords to pin (listed first in results)' },
        location_code: { type: 'number', description: 'DataForSEO location code, e.g. 2840 (United States). Wins over location_name.' },
        location_name: { type: 'string', description: 'DataForSEO location name (default "United States")' },
        language_code: { type: 'string', description: 'Language code (default "en")', default: 'en' },
        device: { type: 'string', enum: ['desktop', 'mobile'], description: 'Device (default desktop)', default: 'desktop' },
        depth: { type: 'number', description: 'Organic results to scan per keyword, 10–100 (default 100; billed per 10)', default: 100 },
      },
    },
    annotations: { title: 'Create a rank tracker', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  schema: rankTrackerCreateSchema,
  run: async (input) => {
    const output = await runRankTrackerCreate(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_update
// ============================================================================

export const rankTrackerUpdateSchema = z.object({
  ...siteStateShape,
  tracker_id: z.string().optional(),
  add: z.array(z.string().min(1)).optional(),
  remove: z.array(z.string().min(1)).optional(),
  pin: z.array(z.string().min(1)).optional(),
  unpin: z.array(z.string().min(1)).optional(),
  name: z.string().optional(),
  depth: z.number().int().min(10).max(100).optional(),
})

export async function runRankTrackerUpdate(input: z.infer<typeof rankTrackerUpdateSchema>, now = new Date()) {
  return guard(() => {
    const store = storeFor(input)
    const before = resolveTracker(store, input.site, input.tracker_id)
    let next = applyKeywordOps(before, input, now)
    if (input.name?.trim()) next = { ...next, name: input.name.trim() }
    if (input.depth) next = { ...next, depth: input.depth }
    if (next.keywords.length > MAX_TRACKER_KEYWORDS) {
      throw new ToolError(ErrorCode.INVALID_INPUT, `A tracker holds at most ${MAX_TRACKER_KEYWORDS} keywords (would have ${next.keywords.length}).`)
    }
    saveTracker(store, next)
    const names = (t: Tracker) => new Set(t.keywords.map((k) => k.keyword))
    const had = names(before)
    const has = names(next)
    return {
      success: true as const,
      tracker: next,
      added: [...has].filter((k) => !had.has(k)),
      removed: [...had].filter((k) => !has.has(k)),
    }
  })
}

export const rankTrackerUpdateSpec = native({
  tool: {
    name: 'rank_tracker_update',
    description:
      'Use to change a rank tracker: add or remove keywords, pin or unpin them (pinned keywords are listed first), rename it, or change depth. ' +
      'The market and device are fixed per tracker so history stays comparable; create another tracker for another market. Local only, free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        tracker_id: trackerIdProp,
        add: { type: 'array', items: { type: 'string' }, description: 'Keywords to add' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Keywords to remove (their history stays in past runs)' },
        pin: { type: 'array', items: { type: 'string' }, description: 'Keywords to pin (added if missing)' },
        unpin: { type: 'array', items: { type: 'string' }, description: 'Keywords to unpin' },
        name: { type: 'string', description: 'New display name' },
        depth: { type: 'number', description: 'New scan depth, 10–100' },
      },
    },
    annotations: { title: 'Update a rank tracker', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  schema: rankTrackerUpdateSchema,
  run: async (input) => {
    const output = await runRankTrackerUpdate(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_get
// ============================================================================

export const rankTrackerGetSchema = z.object({ ...siteStateShape, tracker_id: z.string().optional() })

export async function runRankTrackerGet(input: z.infer<typeof rankTrackerGetSchema>) {
  return guard(() => {
    const store = storeFor(input)
    const tracker = resolveTracker(store, input.site, input.tracker_id)
    const runs = listRuns(store, tracker.site, tracker.id).sort((a, b) => b.ran_at.localeCompare(a.ran_at))
    const latest = runs[0] ?? null
    const pinned = new Set(tracker.keywords.filter((k) => k.pinned).map((k) => k.keyword))
    const results = latest ? sortKeywords(latest.results.filter((r) => tracker.keywords.some((k) => k.keyword === r.keyword)), pinned) : []
    const comparison: RunComparison | null = latest ? compareRuns(runs[1] ?? null, latest.results) : null
    const never = tracker.keywords.filter((k) => !latest?.results.some((r) => r.keyword === k.keyword)).map((k) => k.keyword)
    return {
      success: true as const,
      tracker,
      run_count: runs.length,
      latest_run: latest ? { id: latest.id, ran_at: latest.ran_at, cost_usd: latest.cost_usd } : null,
      results,
      comparison,
      not_yet_checked: never,
    }
  })
}

export const rankTrackerGetSpec = native({
  tool: {
    name: 'rank_tracker_get',
    description:
      'Use to read a rank tracker and its latest positions without buying anything. ' +
      'Returns the tracker (keywords, pinned, market, device), the latest run\'s results (position, ranking URL, SERP features, AI Overview citation, top 3 competitors; pinned first), ' +
      'the change versus the run before (up/down/new/lost), and keywords not checked yet.',
    inputSchema: { type: 'object', required: ['site'], properties: { ...siteStateProperties, tracker_id: trackerIdProp } },
    annotations: { title: 'Rank tracker with latest positions', readOnlyHint: true, openWorldHint: false },
  },
  schema: rankTrackerGetSchema,
  run: async (input) => {
    const output = await runRankTrackerGet(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_history
// ============================================================================

export const rankTrackerHistorySchema = z.object({
  ...siteStateShape,
  tracker_id: z.string().optional(),
  keywords: z.array(z.string().min(1)).optional(),
  max_runs: z.number().int().min(1).max(365).optional().default(30),
})

export async function runRankTrackerHistory(input: z.infer<typeof rankTrackerHistorySchema>) {
  return guard(() => {
    const store = storeFor(input)
    const tracker = resolveTracker(store, input.site, input.tracker_id)
    const runs = listRuns(store, tracker.site, tracker.id)
      .sort((a, b) => b.ran_at.localeCompare(a.ran_at))
      .slice(0, input.max_runs)
    return {
      success: true as const,
      tracker_id: tracker.id,
      market: market(tracker),
      runs: runs.length,
      keywords: buildHistory(tracker, runs, input.keywords),
    }
  })
}

export const rankTrackerHistorySpec = native({
  tool: {
    name: 'rank_tracker_history',
    description:
      'Use to see how rankings moved over time: positions per keyword across stored runs (oldest first), with best and latest position. ' +
      'Optionally limit to some keywords or to the last max_runs runs (default 30). Local only, free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        tracker_id: trackerIdProp,
        keywords: { type: 'array', items: { type: 'string' }, description: 'Only these keywords' },
        max_runs: { type: 'number', description: 'Most recent runs to include (default 30)', default: 30 },
      },
    },
    annotations: { title: 'Rank history', readOnlyHint: true, openWorldHint: false },
  },
  schema: rankTrackerHistorySchema,
  run: async (input) => {
    const output = await runRankTrackerHistory(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_list / rank_tracker_delete
// ============================================================================

export const rankTrackerListSchema = z.object({ ...siteStateShape })

export async function runRankTrackerList(input: z.infer<typeof rankTrackerListSchema>) {
  return guard(() => {
    const store = storeFor(input)
    const site = siteKey(input.site)
    const trackers = listTrackers(store, site).map((t) => {
      const last = latestRun(store, site, t.id)
      return {
        id: t.id,
        name: t.name,
        ...market(t),
        keywords: t.keywords.length,
        pinned: t.keywords.filter((k) => k.pinned).length,
        last_run_at: last?.ran_at ?? null,
      }
    })
    return { success: true as const, site, trackers }
  })
}

export const rankTrackerListSpec = native({
  tool: {
    name: 'rank_tracker_list',
    description: 'Use to list a site\'s rank trackers (id, name, market, device, keyword and pinned counts, last run time). Local only, free.',
    inputSchema: { type: 'object', required: ['site'], properties: { ...siteStateProperties } },
    annotations: { title: 'List rank trackers', readOnlyHint: true, openWorldHint: false },
  },
  schema: rankTrackerListSchema,
  run: async (input) => {
    const output = await runRankTrackerList(input)
    return { output, isError: !output.success }
  },
})

export const rankTrackerDeleteSchema = z.object({
  ...siteStateShape,
  tracker_id: z.string().min(1),
  keep_runs: z.boolean().optional().default(false),
})

export async function runRankTrackerDelete(input: z.infer<typeof rankTrackerDeleteSchema>) {
  return guard(() => {
    const store = storeFor(input)
    const tracker = resolveTracker(store, input.site, input.tracker_id)
    const runs = input.keep_runs ? [] : listRuns(store, tracker.site, tracker.id)
    for (const run of runs) store.deleteRecord(RUNS, tracker.site, run.id)
    store.deleteRecord(TRACKERS, tracker.site, tracker.id)
    return { success: true as const, deleted: tracker.id, runs_deleted: runs.length }
  })
}

export const rankTrackerDeleteSpec = native({
  tool: {
    name: 'rank_tracker_delete',
    description: 'Use to delete a rank tracker and (unless keep_runs) its stored runs. Only local files are removed; nothing at DataForSEO changes.',
    inputSchema: {
      type: 'object',
      required: ['site', 'tracker_id'],
      properties: {
        ...siteStateProperties,
        tracker_id: { type: 'string', description: 'Tracker id' },
        keep_runs: { type: 'boolean', description: 'Keep the stored runs (default false)', default: false },
      },
    },
    annotations: { title: 'Delete a rank tracker', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  schema: rankTrackerDeleteSchema,
  run: async (input) => {
    const output = await runRankTrackerDelete(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_estimate (free)
// ============================================================================

export const rankTrackerEstimateSchema = z.object({
  ...siteStateShape,
  tracker_id: z.string().optional(),
  keywords: z.array(z.string().min(1)).optional(),
})

export async function runRankTrackerEstimate(input: z.infer<typeof rankTrackerEstimateSchema>) {
  return guard(async () => {
    const store = storeFor(input)
    const tracker = resolveTracker(store, input.site, input.tracker_id)
    const plan = planRun(tracker, input.keywords)
    if (plan.length === 0) throw new ToolError(ErrorCode.INVALID_INPUT, 'No tracked keywords match; nothing to estimate.')
    const { balance_usd, ...estimate } = await estimatePlan(plan)
    return { success: true as const, tracker_id: tracker.id, keywords: plan.length, ...market(tracker), estimate, balance_usd }
  })
}

export const rankTrackerEstimateSpec = native({
  tool: {
    name: 'rank_tracker_estimate',
    description:
      'Use before rank_tracker_run to see what a run would cost. Free: prices one live SERP per keyword from DataForSEO\'s own price list ' +
      '(billed per 10 results scanned, so depth 100 = 10 pages) and counts keywords the lookup cache would answer as free. Returns the estimate and the account balance.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        tracker_id: trackerIdProp,
        keywords: { type: 'array', items: { type: 'string' }, description: 'Only these tracked keywords (default all)' },
      },
    },
    annotations: { title: 'Estimate a rank tracker run', readOnlyHint: true, openWorldHint: true },
  },
  schema: rankTrackerEstimateSchema,
  run: async (input) => {
    const output = await runRankTrackerEstimate(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// rank_tracker_run (paid)
// ============================================================================

export const rankTrackerRunSchema = z.object({
  ...siteStateShape,
  tracker_id: z.string().optional(),
  keywords: z.array(z.string().min(1)).optional(),
  ...gateZodShape(1),
})

export type RankTrackerRunResult =
  | {
      success: true
      tracker_id: string
      run_id: string
      ran_at: string
      market: ReturnType<typeof market>
      estimate: CostEstimate
      cost_usd: number | null
      results: KeywordRank[]
      comparison: RunComparison
      errors: number
    }
  | ToolFailureResult

interface SerpResult {
  items?: SerpItem[] | null
}

export async function runRankTrackerRun(input: z.infer<typeof rankTrackerRunSchema>, now = new Date()): Promise<RankTrackerRunResult | EstimateOnlyResult> {
  return guard(async () => {
    const store = storeFor(input)
    const tracker = resolveTracker(store, input.site, input.tracker_id)
    const plan = planRun(tracker, input.keywords)
    if (plan.length === 0) throw new ToolError(ErrorCode.INVALID_INPUT, 'No tracked keywords match; nothing to run.')

    const gate = await gatePaidRun(plan, { max_cost_usd: input.max_cost_usd, estimate_only: input.estimate_only })
    if (!gate.proceed) return gate.output

    const keywords = plan.map((p) => p.task.keyword as string)
    const settled: PromiseSettledResult<{ rank: KeywordRank; cost: number | null }>[] = []
    for (let i = 0; i < keywords.length; i += CONCURRENCY) {
      const batch = keywords.slice(i, i + CONCURRENCY).map(async (keyword) => {
        const { items, cost } = await dataforseoRequest<SerpResult>({ path: SERP_PATH, task: serpTask(tracker, keyword) })
        return { rank: parseSerpForSite(keyword, items[0]?.items ?? [], tracker.site), cost }
      })
      settled.push(...(await Promise.allSettled(batch)))
    }

    if (settled.every((s) => s.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason

    const results = settled.map((s, i): KeywordRank => {
      if (s.status === 'fulfilled') return s.value.rank
      const message = s.reason instanceof Error ? s.reason.message : String(s.reason)
      return {
        keyword: keywords[i], position: null, rank_absolute: null, url: null, serp_features: [],
        ai_overview: { present: false, site_cited: null, cited_url: null }, competitors: [], error: message,
      }
    })

    const previous = latestRun(store, tracker.site, tracker.id)
    const cost = sumCosts(settled.map((s) => (s.status === 'fulfilled' ? s.value.cost : null)))
    const run: RankRun = {
      id: newId(now),
      tracker_id: tracker.id,
      site: tracker.site,
      ran_at: now.toISOString(),
      ...market(tracker),
      results,
      cost_usd: cost,
      estimate_usd: gate.estimate.total_usd,
    }
    store.writeRecord(RUNS, tracker.site, run.id, run, now)

    const pinned = new Set(tracker.keywords.filter((k) => k.pinned).map((k) => k.keyword))
    return {
      success: true as const,
      tracker_id: tracker.id,
      run_id: run.id,
      ran_at: run.ran_at,
      market: market(tracker),
      estimate: gate.estimate,
      cost_usd: cost,
      results: sortKeywords(results, pinned),
      comparison: compareRuns(previous, results),
      errors: results.filter((r) => r.error).length,
    }
  })
}

export const rankTrackerRunSpec = native({
  tool: {
    name: 'rank_tracker_run',
    description:
      'Use to check today\'s Google positions for a rank tracker\'s keywords and store them as a run (paid: one DataForSEO live SERP per keyword, billed per 10 results of depth). ' +
      'Checks the estimate against max_cost_usd (default $1) and the DataForSEO balance before spending; estimate_only: true returns the estimate only. Repeats within 6 h come from the local cache for free. ' +
      'Per keyword: position (Google rank among organic results), rank_absolute, ranking URL, SERP features (ai_overview, people_also_ask, …), whether the site is cited in the AI Overview, top 3 competitors. ' +
      'Also returns the change versus the previous run (up/down/new/lost) and cost_usd. Schedule it with cron; the tool does not schedule itself.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        tracker_id: trackerIdProp,
        keywords: { type: 'array', items: { type: 'string' }, description: 'Only these tracked keywords (default all)' },
        ...gateSchemaProperties(1),
      },
    },
    annotations: { title: 'Run a rank tracker', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  schema: rankTrackerRunSchema,
  run: async (input) => {
    const output = await runRankTrackerRun(input)
    return { output, isError: (output as { success?: boolean }).success !== true }
  },
})

export const rankTrackerSpecs = [
  rankTrackerCreateSpec,
  rankTrackerUpdateSpec,
  rankTrackerGetSpec,
  rankTrackerHistorySpec,
  rankTrackerListSpec,
  rankTrackerDeleteSpec,
  rankTrackerEstimateSpec,
  rankTrackerRunSpec,
]

