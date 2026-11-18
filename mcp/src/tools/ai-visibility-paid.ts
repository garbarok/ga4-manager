import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain, sumCosts } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import { gatePaidRun, gateSchemaProperties, gateZodShape, type CostEstimate, type PlannedRequest } from '../utils/paid-gate.js'
import { StateStore, resolveStateDir, siteKey, newId } from '../utils/state-store.js'
import { loadContext } from '../utils/project-context-store.js'
import { MODEL_IDS, MODELS, DEFAULT_MODELS, type ModelId } from './ai-visibility/models.js'
import { analyzeAnswer, domainMatches, summarize, type Entity, type ModelSummary, type PromptModelResult } from './ai-visibility/detect.js'
import { cells, fetchAll, planFor } from './ai-visibility/engine.js'
import { loadTracker, requireTracker, saveRun, DEFAULT_TRACKER_ID, normalizeCompetitors, type Run, type Tracker } from './ai-visibility/store.js'

/**
 * Paid AI-visibility tools (DataForSEO). Each one prices its requests and
 * passes the cost gate (max_cost_usd, balance, estimate_only) before spending;
 * repeats inside 7 days come from the lookup cache at no cost.
 */

const stateProps = {
  state_dir: { type: 'string', description: 'State directory override (default: .ga4-state next to config, or GA4M_STATE_DIR)' },
  config: { type: 'string', description: 'Site YAML config; its directory holds .ga4-state' },
}
const stateZod = {
  state_dir: z.string().optional(),
  config: z.string().optional(),
}

function storeFor(input: { state_dir?: string; config?: string }): StateStore {
  return new StateStore(resolveStateDir({ stateDir: input.state_dir, config: input.config }))
}

function fail(err: unknown): ToolFailureResult {
  if (err instanceof ToolError) return toolErrorToFailure(err)
  return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
}

const modelsZod = z.array(z.enum(MODEL_IDS)).min(1).max(MODEL_IDS.length)
const modelsJson = {
  type: 'array',
  items: { type: 'string', enum: [...MODEL_IDS] },
  description:
    'AI engines: chatgpt (ChatGPT web UI with search), gemini (Gemini web UI), google_ai_mode, google_ai_overview, ' +
    'claude, perplexity, chatgpt_api, gemini_api (model APIs with web search).',
}

/** Brand terms and competitors: explicit input, else the tracker, else project context. */
function brandAndCompetitors(
  store: StateStore,
  site: string,
  input: { brand_terms?: string[]; competitors?: Entity[] },
  tracker: Tracker | null,
): { terms: string[]; competitors: Entity[] } {
  const ctx = loadContext(store, site)
  const terms = input.brand_terms ?? tracker?.brand_terms ?? (ctx.brand_name ? [ctx.brand_name] : [])
  const competitors = normalizeCompetitors(input.competitors ?? tracker?.competitors ?? ctx.competitors)
  return { terms, competitors }
}

// ============================================================================
// ai_visibility_research
// ============================================================================

export const aiVisibilityResearchInputSchema = z.object({
  site: z.string().optional().describe('Your site (marks its citations); optional'),
  keywords: z.array(z.string().min(1)).min(1).max(10).describe('Seed topics, e.g. ["web analytics", "cookie banner"] (max 10, one billed request each)'),
  platform: z.enum(['google', 'chat_gpt']).optional().default('google'),
  location_name: z.string().optional().default('United States'),
  language_code: z.string().optional().default('en'),
  limit: z.number().int().min(1).max(100).optional().default(20).describe('AI answers to read per keyword (billed per result)'),
  ...gateZodShape(1.5),
  ...stateZod,
})

export type AiVisibilityResearchInput = z.infer<typeof aiVisibilityResearchInputSchema>

interface MentionItem {
  question?: string | null
  answer?: string | null
  ai_search_volume?: number | null
  platform?: string | null
  sources?: { domain?: string | null; url?: string | null; title?: string | null }[] | null
}

export interface ResearchQuestion {
  question: string
  keyword: string
  ai_search_volume: number | null
  source_count: number
  cites_site: boolean | null
  /** Share of the seed keyword's content words found in the question (0–1). */
  relevance: number
}

/** Words that carry no topic, in the languages the tools target. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'how', 'what', 'best', 'app', 'apps', 'tool', 'tools',
  'para', 'con', 'que', 'los', 'las', 'del', 'una', 'mejor', 'mejores', 'como', 'cual',
  'der', 'die', 'das', 'und', 'mit', 'fur', 'beste', 'wie', 'les', 'des', 'pour', 'avec', 'meilleur', 'meilleure',
])

/** Lowercase, accent-free content words, cut to a 5-letter stem so plurals and inflections match. */
export function topicStems(text: string): string[] {
  return (text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w).slice(0, 5))
}

/**
 * How on-topic a question is for its seed keyword. LLM Mentions matches
 * loosely (a seed like "app mantenimiento moto" returns "uber eats
 * repartidor"), so questions below MIN_RELEVANCE are set aside.
 */
export function relevanceTo(seed: string, question: string): number {
  const want = [...new Set(topicStems(seed))]
  if (want.length === 0) return 1
  const have = new Set(topicStems(question))
  return Math.round((want.filter((w) => have.has(w)).length / want.length) * 100) / 100
}

export const MIN_RELEVANCE = 0.5

export function researchPlan(input: AiVisibilityResearchInput): PlannedRequest[] {
  return input.keywords.map((keyword) => ({
    path: 'ai_optimization/llm_mentions/search/live',
    // Same task shape as llm_mentions, so the two share the lookup cache.
    task: {
      target: [{ keyword }],
      platform: input.platform,
      location_name: input.location_name,
      language_code: input.language_code,
      limit: input.limit,
    },
    expected_results: input.limit,
  }))
}

export function digestResearch(
  perKeyword: { keyword: string; items: MentionItem[] }[],
  site: string | null,
): { questions: ResearchQuestion[]; low_relevance: ResearchQuestion[]; top_cited_domains: { domain: string; citations: number; is_own: boolean }[] } {
  const questions = new Map<string, ResearchQuestion>()
  const domains = new Map<string, number>()
  for (const { keyword, items } of perKeyword) {
    for (const item of items) {
      const sources = item.sources ?? []
      for (const s of sources) {
        const d = s.domain || (s.url ? normalizeDomain(s.url) : null)
        if (d) domains.set(normalizeDomain(d), (domains.get(normalizeDomain(d)) ?? 0) + 1)
      }
      const q = item.question?.trim()
      if (!q) continue
      const key = q.toLowerCase()
      if (questions.has(key)) continue
      questions.set(key, {
        question: q,
        keyword,
        ai_search_volume: typeof item.ai_search_volume === 'number' ? item.ai_search_volume : null,
        source_count: sources.length,
        cites_site: site ? sources.some((s) => domainMatches(s.domain ?? (s.url ? normalizeDomain(s.url) : null), site)) : null,
        relevance: relevanceTo(keyword, q),
      })
    }
  }
  const sorted = [...questions.values()].sort(
    (a, b) => b.relevance - a.relevance || (b.ai_search_volume ?? -1) - (a.ai_search_volume ?? -1) || a.question.localeCompare(b.question),
  )
  return {
    questions: sorted.filter((q) => q.relevance >= MIN_RELEVANCE),
    low_relevance: sorted.filter((q) => q.relevance < MIN_RELEVANCE),
    top_cited_domains: [...domains.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([domain, citations]) => ({ domain, citations, is_own: site ? domainMatches(domain, site) : false })),
  }
}

export async function runAiVisibilityResearch(input: AiVisibilityResearchInput): Promise<unknown> {
  try {
    const site = input.site ? siteKey(input.site) : null
    const plan = researchPlan(input)
    const gate = await gatePaidRun(plan, input)
    if (!gate.proceed) return gate.output

    const settled = await Promise.allSettled(
      plan.map(async (req, i) => {
        const { items, cost } = await dataforseoRequest<{ items?: MentionItem[] | null }>({ path: req.path, task: req.task, timeoutMs: 150_000 })
        return { keyword: input.keywords[i], items: items[0]?.items ?? [], cost }
      }),
    )
    if (settled.every((s) => s.status === 'rejected')) return fail((settled[0] as PromiseRejectedResult).reason)
    const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
    const errors = settled.flatMap((s, i) =>
      s.status === 'rejected' ? [{ keyword: input.keywords[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) }] : [],
    )
    const digest = digestResearch(ok, site)
    return {
      success: true,
      site,
      platform: input.platform,
      questions: digest.questions,
      // Loosely matched questions LLM Mentions returned; kept for review, not suggested.
      low_relevance: digest.low_relevance,
      top_cited_domains: digest.top_cited_domains,
      suggested_prompts: digest.questions.slice(0, 30).map((q) => q.question),
      errors,
      estimate: gate.estimate,
      cost_usd: sumCosts(ok.map((o) => o.cost)),
      next_step: 'Save the prompts worth tracking with ai_visibility_tracker_save, then check the cost with ai_visibility_estimate.',
    }
  } catch (err) {
    return fail(err)
  }
}

export const aiVisibilityResearchSpec = native({
  tool: {
    name: 'ai_visibility_research',
    description:
      'Use to find the questions people actually ask AI assistants about a market, and which sites those answers cite, before choosing prompts to track ' +
      '(OpenSEO research_ai_visibility_prompts). Backed by DataForSEO LLM Mentions (paid: about $0.10 per keyword plus $0.001 per answer read); ' +
      'cost-gated: estimate_only returns the estimate, and the run is refused above max_cost_usd or the balance. ' +
      'Returns questions (with AI search volume when known and whether your site is cited), top_cited_domains, and suggested_prompts to pass to ai_visibility_tracker_save.',
    inputSchema: {
      type: 'object',
      required: ['keywords'],
      properties: {
        site: { type: 'string', description: 'Your site, to flag its citations (optional)' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Seed topics (max 10, one billed request each)' },
        platform: { type: 'string', enum: ['google', 'chat_gpt'], default: 'google', description: 'AI answer database: google (AI Overviews) or chat_gpt' },
        location_name: { type: 'string', default: 'United States', description: 'DataForSEO location name' },
        language_code: { type: 'string', default: 'en', description: 'Language code' },
        limit: { type: 'number', default: 20, description: 'AI answers to read per keyword (1-100, billed per result)' },
        ...gateSchemaProperties(1.5),
        ...stateProps,
      },
    },
    annotations: { title: 'Research AI prompts for a market', readOnlyHint: true, openWorldHint: true },
  },
  schema: aiVisibilityResearchInputSchema,
  run: async (input) => {
    const output = (await runAiVisibilityResearch(input)) as { success: boolean }
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ai_visibility_explore
// ============================================================================

const entityZod = z.object({ domain: z.string().min(1), name: z.string().optional() })
const entityJson = {
  type: 'array',
  items: { type: 'object', required: ['domain'], properties: { domain: { type: 'string' }, name: { type: 'string' } } },
}

export const aiVisibilityExploreInputSchema = z.object({
  site: z.string().min(1).describe('Your site, e.g. example.com'),
  prompt: z.string().min(3).max(500),
  models: modelsZod.optional(),
  brand_terms: z.array(z.string().min(2)).max(20).optional(),
  competitors: z.array(entityZod).max(20).optional(),
  location_code: z.number().int().optional().default(2840),
  language_code: z.string().optional().default('en'),
  max_answer_chars: z.number().int().min(200).max(50_000).optional().default(4000),
  ...gateZodShape(0.25),
  ...stateZod,
})

export type AiVisibilityExploreInput = z.infer<typeof aiVisibilityExploreInputSchema>

export async function runAiVisibilityExplore(input: AiVisibilityExploreInput): Promise<unknown> {
  try {
    const site = siteKey(input.site)
    const store = storeFor(input)
    const tracker = loadTracker(store, site)
    const models = input.models ?? tracker?.models ?? DEFAULT_MODELS
    const opts = { location_code: input.location_code, language_code: input.language_code }
    const list = cells([input.prompt], models)
    const gate = await gatePaidRun(planFor(list, opts), input)
    if (!gate.proceed) return gate.output

    const { terms, competitors } = brandAndCompetitors(store, site, input, tracker)
    const { answers, cost_usd } = await fetchAll(list, opts)
    if (answers.every((a) => a.error)) return errorResult(ErrorCode.UPSTREAM_5XX, answers[0].error ?? 'All engines failed.')
    const results = answers.map((a) => analyzeAnswer(a, { site, terms }, competitors))
    return {
      success: true,
      site,
      prompt: input.prompt,
      answers: answers.map((a, i) => ({
        model: a.model,
        model_version: a.model_version,
        available: a.available,
        answer: a.answer_text.slice(0, input.max_answer_chars),
        answer_truncated: a.answer_text.length > input.max_answer_chars,
        sources: a.sources,
        analysis: results[i],
        ...(a.error ? { error: a.error } : {}),
      })),
      summary: summarize(results, site, competitors),
      estimate: gate.estimate,
      cost_usd,
      note: 'Explore results are not stored as a run (the answers stay in the 7-day lookup cache). Save the prompt with ai_visibility_tracker_save to track it.',
    }
  } catch (err) {
    return fail(err)
  }
}

export const aiVisibilityExploreSpec = native({
  tool: {
    name: 'ai_visibility_explore',
    description:
      'Use to ask ONE prompt across AI engines right now and see each answer, whether it mentions or cites the site, and which competitors appear ' +
      '(OpenSEO explore_prompt). Paid via DataForSEO (about $0.002–0.04 per engine); cost-gated (max_cost_usd, balance, estimate_only). ' +
      'Brand terms and competitors default to the saved tracker, then project context. Not stored as a run; repeats within 7 days are free from cache.',
    inputSchema: {
      type: 'object',
      required: ['site', 'prompt'],
      properties: {
        site: { type: 'string', description: 'Your site, e.g. example.com' },
        prompt: { type: 'string', description: 'The question to ask, as a user would type it' },
        models: { ...modelsJson, description: `${modelsJson.description} Default: tracker models, else ${DEFAULT_MODELS.join(', ')}.` },
        brand_terms: { type: 'array', items: { type: 'string' }, description: 'Names that count as a brand mention besides the domain' },
        competitors: { ...entityJson, description: 'Competitors to watch: {domain, name?}' },
        location_code: { type: 'number', default: 2840, description: 'DataForSEO location code (2840 = United States)' },
        language_code: { type: 'string', default: 'en', description: 'Language code' },
        max_answer_chars: { type: 'number', default: 4000, description: 'Truncate each answer in the output to this many characters' },
        ...gateSchemaProperties(0.25),
        ...stateProps,
      },
    },
    annotations: { title: 'Explore one prompt across AI engines', readOnlyHint: true, openWorldHint: true },
  },
  schema: aiVisibilityExploreInputSchema,
  run: async (input) => {
    const output = (await runAiVisibilityExplore(input)) as { success: boolean }
    return { output, isError: !output.success }
  },
})

// ============================================================================
// ai_visibility_estimate / ai_visibility_run
// ============================================================================

export const aiVisibilityRunInputSchema = z.object({
  site: z.string().min(1),
  tracker_id: z.string().optional().default(DEFAULT_TRACKER_ID),
  models: modelsZod.optional().describe('Subset of engines for this run (default: the tracker models)'),
  tags: z.array(z.string()).optional().describe('Only prompts carrying one of these tags'),
  ...gateZodShape(2),
  ...stateZod,
})

export type AiVisibilityRunInput = z.infer<typeof aiVisibilityRunInputSchema>

function runCells(tracker: Tracker, input: { models?: ModelId[]; tags?: string[] }) {
  const prompts = tracker.prompts.filter((p) => !input.tags?.length || p.tags.some((t) => input.tags!.includes(t))).map((p) => p.text)
  const models = input.models ?? tracker.models
  return { prompts, models, list: cells(prompts, models) }
}

const runInputProps = {
  site: { type: 'string', description: 'Your site, e.g. example.com' },
  tracker_id: { type: 'string', default: DEFAULT_TRACKER_ID, description: 'Saved prompt set (default "default")' },
  models: { ...modelsJson, description: 'Subset of engines for this run (default: the tracker models)' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Only prompts carrying one of these tags' },
}

export const aiVisibilityEstimateInputSchema = aiVisibilityRunInputSchema.omit({ estimate_only: true, refresh_cache: true })

export async function runAiVisibilityEstimate(input: z.infer<typeof aiVisibilityEstimateInputSchema>): Promise<unknown> {
  try {
    const site = siteKey(input.site)
    const tracker = requireTracker(storeFor(input), site, input.tracker_id)
    const { prompts, models, list } = runCells(tracker, input)
    const opts = { location_code: tracker.location_code, language_code: tracker.language_code }
    const gate = await gatePaidRun(planFor(list, opts), { max_cost_usd: input.max_cost_usd, estimate_only: true })
    if (gate.proceed) throw new Error('unreachable: estimate_only never proceeds')
    const out = gate.output as { success: boolean }
    if (!out.success) return out
    return { ...out, site, tracker_id: tracker.id, prompts: prompts.length, models, requests: list.length }
  } catch (err) {
    return fail(err)
  }
}

export const aiVisibilityEstimateSpec = native({
  tool: {
    name: 'ai_visibility_estimate',
    description:
      'Use before ai_visibility_run: prices a run of the saved prompt set across its engines from DataForSEO\'s live price list and reads the balance. ' +
      'Free, spends nothing. Cached answers (7 days) count as $0. Returns estimate (per-endpoint lines), balance_usd, would_run and the request count.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...runInputProps,
        max_cost_usd: { type: 'number', default: 2, description: 'The cap a real run would use; would_run says whether it fits' },
        ...stateProps,
      },
    },
    annotations: { title: 'Estimate an AI-visibility run', readOnlyHint: true, openWorldHint: true },
  },
  schema: aiVisibilityEstimateInputSchema,
  run: async (input) => {
    const output = (await runAiVisibilityEstimate(input)) as { success: boolean }
    return { output, isError: !output.success }
  },
})

export interface RunOutput {
  success: true
  site: string
  run_id: string
  tracker_id: string
  prompts: number
  models: ModelId[]
  summary: ModelSummary[]
  /** Prompt × engine cells that failed (kept in the run with `error`). */
  failed: { prompt: string; model: ModelId; error: string }[]
  not_mentioned: { prompt: string; model: ModelId; competitors_mentioned: string[] }[]
  estimate: CostEstimate
  cost_usd: number | null
}

export async function runAiVisibilityRun(input: AiVisibilityRunInput, now: () => Date = () => new Date()): Promise<RunOutput | unknown> {
  try {
    const site = siteKey(input.site)
    const store = storeFor(input)
    const tracker = requireTracker(store, site, input.tracker_id)
    const { prompts, models, list } = runCells(tracker, input)
    if (list.length === 0) return errorResult(ErrorCode.INVALID_INPUT, 'No prompts match this tracker and tag filter.')
    const opts = { location_code: tracker.location_code, language_code: tracker.language_code }
    const gate = await gatePaidRun(planFor(list, opts), input)
    if (!gate.proceed) return gate.output

    const started = now()
    const { answers, cost_usd } = await fetchAll(list, opts)
    if (answers.every((a) => a.error)) return errorResult(ErrorCode.UPSTREAM_5XX, `Every request failed: ${answers[0].error}`)

    const brand = { site, terms: tracker.brand_terms }
    const results: PromptModelResult[] = answers.map((a) => analyzeAnswer(a, brand, tracker.competitors))
    const run: Run = {
      id: newId(started),
      site,
      tracker_id: tracker.id,
      started_at: started.toISOString(),
      finished_at: now().toISOString(),
      models,
      location_code: tracker.location_code,
      language_code: tracker.language_code,
      brand_terms: tracker.brand_terms,
      competitors: tracker.competitors,
      prompt_count: prompts.length,
      cost_usd,
      summary: summarize(results, site, tracker.competitors),
      results,
      answers,
    }
    saveRun(store, run)
    return {
      success: true,
      site,
      run_id: run.id,
      tracker_id: tracker.id,
      prompts: prompts.length,
      models,
      summary: run.summary,
      failed: results.filter((r) => r.error).map((r) => ({ prompt: r.prompt, model: r.model, error: r.error! })),
      not_mentioned: results
        .filter((r) => r.available && !r.mentioned && !r.error)
        .map((r) => ({ prompt: r.prompt, model: r.model, competitors_mentioned: r.competitors.filter((c) => c.mentioned).map((c) => c.domain) })),
      estimate: gate.estimate,
      cost_usd,
    } satisfies RunOutput
  } catch (err) {
    return fail(err)
  }
}

export const aiVisibilityRunSpec = native({
  tool: {
    name: 'ai_visibility_run',
    description:
      'Use to measure AI visibility: asks every prompt in the saved tracker across its engines (ChatGPT, Google AI Overview/AI Mode, Gemini, Claude, Perplexity...) ' +
      'and stores the answers, brand mentions (with rank vs competitors), citations and competitor appearances as a dated run (OpenSEO run_ai_visibility_check). ' +
      'Paid via DataForSEO and cost-gated: check ai_visibility_estimate first; refused above max_cost_usd (default $2) or the balance. ' +
      'Returns run_id, per-engine mention_rate / citation_rate / share_of_voice, and the prompts where the brand is missing. ' +
      'Read details later with ai_visibility_results, ai_visibility_trend, ai_visibility_sources, ai_visibility_answer. Schedule it with cron via `ga4m ai-visibility-run`.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: { ...runInputProps, ...gateSchemaProperties(2), ...stateProps },
    },
    annotations: { title: 'Run AI-visibility tracking', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  schema: aiVisibilityRunInputSchema,
  run: async (input) => {
    const output = (await runAiVisibilityRun(input)) as { success: boolean }
    return { output, isError: !output.success }
  },
})

export { MODELS }
