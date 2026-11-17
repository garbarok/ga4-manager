import { z } from 'zod'
import { dataforseoRequest } from './dataforseo-client.js'
import { ToolError, ErrorCode, errorResult, toolErrorToFailure, type ToolFailureResult } from './errors.js'
import { currentContext } from './tool-context.js'
import { cacheEnabled, cacheKey, readCache } from './lookup-cache.js'

/**
 * Cost estimate + balance gate for every DataForSEO-spending tool added by the
 * OpenSEO-parity changes. Before a paid run a tool:
 *   1. lists the requests it would make (endpoint path + task body),
 *   2. prices them from DataForSEO's own price list (appendix/user_data, free),
 *      counting requests the lookup cache would answer as free,
 *   3. reads the account balance from the same free call,
 *   4. refuses when the estimate exceeds `max_cost_usd` or the balance, and
 *      returns the estimate without spending when `estimate_only` is set.
 * The session caps in spend-guard.ts still apply on top of this.
 */

export interface PlannedRequest {
  /** DataForSEO path after /v3/, e.g. "serp/google/organic/live/advanced". */
  path: string
  /** The exact task body; used to check the lookup cache. */
  task: Record<string, unknown>
  /** Results the request is expected to bill for (per_result endpoints). */
  expected_results?: number
  /**
   * Measured cost the price list does not show (e.g. Google AI Overview async
   * loading, LLM tokens above the built-in allowance). Added when not cached.
   */
  surcharge_usd?: number
}

export interface CostLine {
  endpoint: string
  requests: number
  cached_requests: number
  unit_request_usd: number
  unit_result_usd: number
  /** SERP pages billed per request (depth / 10, rounded up). */
  pages_per_request: number
  expected_results_per_request: number
  subtotal_usd: number
}

export interface CostEstimate {
  total_usd: number
  requests: number
  cached_requests: number
  lines: CostLine[]
  price_source: 'live' | 'builtin'
  notes: string[]
}

interface UnitPrice {
  per_request: number
  per_result: number
}

/**
 * Fallback prices (USD, normal priority), copied from appendix/user_data on
 * 2026-11-17. Used only when the live price list cannot be read.
 */
const BUILTIN_PRICES: Record<string, UnitPrice> = {
  'serp/live/advanced': { per_request: 0.002, per_result: 0 },
  'serp/live/regular': { per_request: 0.002, per_result: 0 },
  'ai_optimization/llm_scraper/live/advanced': { per_request: 0.004, per_result: 0 },
  'ai_optimization/llm_responses/live': { per_request: 0.0006, per_result: 0 },
  'ai_optimization/llm_mentions/search/live': { per_request: 0.1, per_result: 0.001 },
  'ai_optimization/ai_keyword_data/keywords_search_volume/live': { per_request: 0.01, per_result: 0.0001 },
  'dataforseo_labs/serp_competitors/live': { per_request: 0.012, per_result: 0.00012 },
  'dataforseo_labs/domain_rank_overview/live': { per_request: 0.012, per_result: 0.00012 },
  'dataforseo_labs/relevant_pages/live': { per_request: 0.012, per_result: 0.00012 },
  'dataforseo_labs/keywords_for_site/live': { per_request: 0.012, per_result: 0.00012 },
  'dataforseo_labs/keyword_suggestions/live': { per_request: 0.012, per_result: 0.00012 },
  'dataforseo_labs/ranked_keywords/live': { per_request: 0.012, per_result: 0.00012 },
  'keywords_data/google_ads/search_volume/live': { per_request: 0.09, per_result: 0 },
}

/** Model calls in llm_responses are billed by tokens on top of the request fee. */
const LLM_RESPONSE_TOKEN_ALLOWANCE_USD = 0.01

interface PriceLeaf {
  cost_type: 'per_request' | 'per_result'
  cost: number
}

let livePrices: { tree: Record<string, unknown>; balance: number | null; at: number } | null = null
const PRICE_TTL_MS = 10 * 60_000

/** The account balance and the price tree, from one free call. Prices are reused for 10 minutes. */
async function readUserData(forceFresh: boolean): Promise<{ tree: Record<string, unknown> | null; balance: number | null }> {
  if (!forceFresh && livePrices && Date.now() - livePrices.at < PRICE_TTL_MS) return livePrices
  try {
    const { items } = await dataforseoRequest<{ price?: Record<string, unknown>; money?: { balance?: number } }>({
      method: 'GET',
      path: 'appendix/user_data',
      unbilled: true,
    })
    const tree = items[0]?.price ?? null
    const balance = typeof items[0]?.money?.balance === 'number' ? items[0].money.balance : null
    if (tree) livePrices = { tree, balance, at: Date.now() }
    return { tree, balance }
  } catch (err) {
    if (err instanceof ToolError && err.code === ErrorCode.AUTH_DENIED) throw err
    return { tree: null, balance: null }
  }
}

/** Reset cached prices. For tests. */
export function resetPriceCache(): void {
  livePrices = null
}

/** Engine / product segments DataForSEO puts in paths but not in its price tree. */
const SEGMENTS_NOT_PRICED = new Set([
  'google', 'bing', 'yahoo', 'baidu', 'naver', 'seznam', 'youtube', 'amazon',
  'chat_gpt', 'claude', 'gemini', 'perplexity',
  'organic', 'ai_mode', 'news', 'images', 'maps', 'local_finder', 'events', 'jobs', 'autocomplete',
])

/** "serp/google/organic/live/advanced" → "serp/live/advanced". */
export function pricePathFor(path: string): string {
  return path
    .split('/')
    .filter((seg, i) => i === 0 || !SEGMENTS_NOT_PRICED.has(seg))
    .join('/')
}

export function lookupPrice(tree: Record<string, unknown> | null, path: string): UnitPrice | null {
  const key = pricePathFor(path)
  if (tree) {
    let node: unknown = tree
    for (const seg of key.split('/')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined
    }
    const leaves = (node as Record<string, unknown> | undefined)?.priority_normal as PriceLeaf[] | undefined
    if (Array.isArray(leaves)) {
      const unit: UnitPrice = { per_request: 0, per_result: 0 }
      for (const leaf of leaves) {
        if (leaf.cost_type === 'per_request') unit.per_request += leaf.cost
        else if (leaf.cost_type === 'per_result') unit.per_result += leaf.cost
      }
      return unit
    }
  }
  return BUILTIN_PRICES[key] ?? null
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** SERP endpoints bill each 10 results as one page (measured: depth 30 = 3 × $0.002). */
export function pagesFor(path: string, task: Record<string, unknown>): number {
  if (!path.startsWith('serp/')) return 1
  const depth = typeof task.depth === 'number' ? task.depth : 10
  return Math.max(1, Math.ceil(depth / 10))
}

/** Price a plan. Pure apart from the cache lookups, so tests can pass a price tree. */
export function priceRequests(
  plan: PlannedRequest[],
  tree: Record<string, unknown> | null,
  isCached: (req: PlannedRequest) => boolean = () => false,
): CostEstimate {
  const lines = new Map<string, CostLine>()
  const notes: string[] = []
  let unknown = 0
  for (const req of plan) {
    const unit = lookupPrice(tree, req.path)
    if (!unit) unknown += 1
    const u = unit ?? { per_request: 0, per_result: 0 }
    const pages = pagesFor(req.path, req.task)
    const results = req.expected_results ?? 0
    const cached = isCached(req)
    const tokenAllowance = req.path.includes('/llm_responses/') ? LLM_RESPONSE_TOKEN_ALLOWANCE_USD : 0
    const cost = cached ? 0 : u.per_request * pages + u.per_result * results + tokenAllowance + (req.surcharge_usd ?? 0)
    const line = lines.get(req.path) ?? {
      endpoint: req.path,
      requests: 0,
      cached_requests: 0,
      unit_request_usd: u.per_request,
      unit_result_usd: u.per_result,
      pages_per_request: pages,
      expected_results_per_request: results,
      subtotal_usd: 0,
    }
    line.requests += 1
    if (cached) line.cached_requests += 1
    line.subtotal_usd = round6(line.subtotal_usd + cost)
    lines.set(req.path, line)
  }
  if (unknown > 0) notes.push(`${unknown} request(s) hit an endpoint with no known price; they are counted as $0.`)
  if (plan.some((r) => r.path.includes('/llm_responses/'))) {
    notes.push(`LLM responses also bill model tokens; each request includes a $${LLM_RESPONSE_TOKEN_ALLOWANCE_USD} allowance for them.`)
  }
  const all = [...lines.values()]
  return {
    total_usd: round6(all.reduce((a, l) => a + l.subtotal_usd, 0)),
    requests: plan.length,
    cached_requests: all.reduce((a, l) => a + l.cached_requests, 0),
    lines: all,
    price_source: tree ? 'live' : 'builtin',
    notes,
  }
}

/** True when the lookup cache would answer this request inside the current tool call. */
function cachedInContext(req: PlannedRequest): boolean {
  const ctx = currentContext()
  if (!ctx || ctx.refresh || !cacheEnabled()) return false
  return readCache(ctx.stateDir, ctx.site, cacheKey('POST', req.path, req.task)) !== null
}

export async function estimatePlan(plan: PlannedRequest[]): Promise<CostEstimate & { balance_usd: number | null }> {
  const { tree, balance } = await readUserData(false)
  return { ...priceRequests(plan, tree, cachedInContext), balance_usd: balance }
}

export interface GateOptions {
  max_cost_usd: number
  estimate_only: boolean
}

export type GateOutcome =
  | { proceed: true; estimate: CostEstimate; balance_usd: number | null }
  | { proceed: false; output: EstimateOnlyResult | ToolFailureResult }

export interface EstimateOnlyResult {
  success: true
  estimate_only: true
  estimate: CostEstimate
  balance_usd: number | null
  max_cost_usd: number
  /** Whether a real run with the same input would pass the gate. */
  would_run: boolean
  blocked_reason: string | null
}

/**
 * The gate itself. A fresh balance is read on every paid run; an estimate of
 * $0 (everything cached) skips the balance check.
 */
export async function gatePaidRun(plan: PlannedRequest[], opts: GateOptions): Promise<GateOutcome> {
  let tree: Record<string, unknown> | null
  let balance: number | null
  try {
    ;({ tree, balance } = await readUserData(!opts.estimate_only))
  } catch (err) {
    if (err instanceof ToolError) return { proceed: false, output: toolErrorToFailure(err) }
    throw err
  }
  const estimate = priceRequests(plan, tree, cachedInContext)

  let blocked: ToolFailureResult | null = null
  if (estimate.total_usd > opts.max_cost_usd) {
    blocked = errorResult(
      ErrorCode.INVALID_INPUT,
      `Estimated cost $${estimate.total_usd} exceeds max_cost_usd $${opts.max_cost_usd}.`,
      'Raise max_cost_usd, or reduce keywords/prompts/models/depth. Run with estimate_only: true to see the breakdown.',
    )
  } else if (estimate.total_usd > 0 && balance !== null && balance < estimate.total_usd) {
    blocked = errorResult(
      ErrorCode.QUOTA_EXCEEDED,
      `DataForSEO balance $${balance} is below the estimated cost $${estimate.total_usd}.`,
      'Top up the DataForSEO account or reduce the request.',
    )
  }

  if (opts.estimate_only) {
    return {
      proceed: false,
      output: {
        success: true,
        estimate_only: true,
        estimate,
        balance_usd: balance,
        max_cost_usd: opts.max_cost_usd,
        would_run: blocked === null,
        blocked_reason: blocked?.error.message ?? null,
      },
    }
  }
  if (blocked) {
    return { proceed: false, output: { ...blocked, error: { ...blocked.error, hint: `${blocked.error.hint ?? ''} Estimate: ${JSON.stringify(estimate.lines)}`.trim() } } }
  }
  return { proceed: true, estimate, balance_usd: balance }
}

/** The JSON-schema fragment every paid tool advertises for the gate inputs. */
export function gateSchemaProperties(defaultMax: number): Record<string, unknown> {
  return {
    max_cost_usd: {
      type: 'number',
      description: `Refuse the run when the estimated DataForSEO cost is above this (default ${defaultMax}).`,
      default: defaultMax,
    },
    estimate_only: {
      type: 'boolean',
      description: 'Return the cost estimate and balance without spending anything (default false).',
      default: false,
    },
    refresh_cache: {
      type: 'boolean',
      description: 'Ignore cached lookups and buy fresh data (default false; cached results are free).',
      default: false,
    },
  }
}

/** The zod fields matching gateSchemaProperties(). Spread into a tool's z.object(). */
export function gateZodShape(defaultMax: number) {
  return {
    max_cost_usd: z.number().min(0).max(100).optional().default(defaultMax),
    estimate_only: z.boolean().optional().default(false),
    refresh_cache: z.boolean().optional().default(false),
  }
}
