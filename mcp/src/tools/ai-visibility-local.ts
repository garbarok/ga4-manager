import { z } from 'zod'
import { join } from 'node:path'
import { native } from '../tool-spec.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'
import { StateStore, resolveStateDir, siteKey, safeId, atomicWriteJson } from '../utils/state-store.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadContext } from '../utils/project-context-store.js'
import { MODEL_IDS, DEFAULT_MODELS, MODELS, type ModelId } from './ai-visibility/models.js'
import { analyzeAnswer } from './ai-visibility/detect.js'
import { brandFromDomain, contextInputs, generatePrompts } from './ai-visibility/generate.js'
import {
  DEFAULT_TRACKER_ID,
  exportRows,
  loadRun,
  loadRuns,
  loadTracker,
  normalizeCompetitors,
  saveTracker,
  toCsv,
  topSources,
  trend,
  type Tracker,
  type TrackedPrompt,
} from './ai-visibility/store.js'

/**
 * Free AI-visibility tools over local state: prompt generation from project
 * context, the saved tracker, and reads over stored runs. No network.
 */

const stateZod = { state_dir: z.string().optional(), config: z.string().optional() }
const stateProps = {
  state_dir: { type: 'string', description: 'State directory override (default: .ga4-state next to config, or GA4M_STATE_DIR)' },
  config: { type: 'string', description: 'Site YAML config; its directory holds .ga4-state' },
}
const siteProp = { site: { type: 'string', description: 'Your site, e.g. example.com' } }

function storeFor(input: { state_dir?: string; config?: string }): StateStore {
  return new StateStore(resolveStateDir({ stateDir: input.state_dir, config: input.config }))
}

function fail(err: unknown): ToolFailureResult {
  if (err instanceof ToolError) return toolErrorToFailure(err)
  return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
}

function wrap<T>(fn: (input: T) => unknown) {
  return async (input: T) => {
    let output: unknown
    try {
      output = fn(input)
    } catch (err) {
      output = fail(err)
    }
    return { output, isError: !(output as { success: boolean }).success }
  }
}

// ============================================================================
// ai_visibility_prompts_generate
// ============================================================================

export const promptsGenerateInputSchema = z.object({
  site: z.string().min(1),
  topics: z.array(z.string().min(2)).max(20).optional().describe('Extra topics besides key-page topics in project context'),
  audience: z.string().optional().describe('Who asks, e.g. "small businesses"'),
  max: z.number().int().min(1).max(100).optional().default(40),
  ...stateZod,
})

export function runPromptsGenerate(input: z.infer<typeof promptsGenerateInputSchema>) {
  const site = siteKey(input.site)
  const ctx = loadContext(storeFor(input), site)
  const hasContext = ctx.updated_at !== null
  const base = contextInputs(hasContext ? ctx : null, input.topics ?? [])
  const brand = base.brand ?? brandFromDomain(site)
  const prompts = generatePrompts({ ...base, brand, audience: input.audience, max: input.max })
  const warnings: string[] = []
  if (!hasContext) warnings.push('No project context for this site: only the topics you passed were used. Fill it with project_context_update (brand, competitors, key pages).')
  if (base.topics.length === 0) warnings.push('No topics: pass topics, or add key pages with a topic to project context.')
  return {
    success: true,
    site,
    prompts,
    sources_used: { brand, topics: base.topics, competitors: base.competitors.map((c) => c.domain) },
    warnings,
    next_step: 'Pick the prompts worth tracking and save them with ai_visibility_tracker_save (prompts: [{text, tags}]).',
  }
}

export const aiVisibilityPromptsGenerateSpec = native({
  tool: {
    name: 'ai_visibility_prompts_generate',
    description:
      'Use to draft AI-visibility prompts for a site from its project context (brand, competitors, key-page topics) plus optional topics and audience: ' +
      '"best {topic} tools", "{brand} vs {competitor}", "alternatives to {competitor}", "{brand} reviews"... (OpenSEO generate_ai_visibility_prompts). ' +
      'Deterministic templates, free, no API call. For the questions people really ask, use ai_visibility_research (paid).',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        topics: { type: 'array', items: { type: 'string' }, description: 'Extra topics besides key-page topics in project context' },
        audience: { type: 'string', description: 'Who asks, e.g. "small businesses"' },
        max: { type: 'number', default: 40, description: 'Maximum prompts returned (1-100)' },
        ...stateProps,
      },
    },
    annotations: { title: 'Generate AI-visibility prompts', readOnlyHint: true, openWorldHint: false },
  },
  schema: promptsGenerateInputSchema,
  run: wrap(runPromptsGenerate),
})

// ============================================================================
// ai_visibility_tracker_save
// ============================================================================

const promptZod = z.union([z.string().min(3).max(500), z.object({ text: z.string().min(3).max(500), tags: z.array(z.string()).optional() })])

export const trackerSaveInputSchema = z.object({
  site: z.string().min(1),
  tracker_id: z.string().optional().default(DEFAULT_TRACKER_ID),
  prompts: z.array(promptZod).max(200).optional().describe('Replace the prompt set'),
  add_prompts: z.array(promptZod).max(200).optional(),
  remove_prompts: z.array(z.string()).max(200).optional(),
  models: z.array(z.enum(MODEL_IDS)).min(1).optional(),
  brand_terms: z.array(z.string().min(2)).max(20).optional(),
  competitors: z.array(z.object({ domain: z.string().min(1), name: z.string().optional() })).max(20).optional(),
  location_code: z.number().int().optional(),
  language_code: z.string().optional(),
  ...stateZod,
})

function toPrompt(p: z.infer<typeof promptZod>): TrackedPrompt {
  return typeof p === 'string' ? { text: p.trim(), tags: [] } : { text: p.text.trim(), tags: p.tags ?? [] }
}

export function runTrackerSave(input: z.infer<typeof trackerSaveInputSchema>, now: Date = new Date()) {
  const site = siteKey(input.site)
  const store = storeFor(input)
  const id = safeId(input.tracker_id)
  const existing = loadTracker(store, site, id)
  const ctx = loadContext(store, site)

  let prompts = input.prompts ? input.prompts.map(toPrompt) : (existing?.prompts ?? [])
  if (input.add_prompts) prompts = [...prompts, ...input.add_prompts.map(toPrompt)]
  if (input.remove_prompts) {
    const drop = new Set(input.remove_prompts.map((p) => p.trim().toLowerCase()))
    prompts = prompts.filter((p) => !drop.has(p.text.toLowerCase()))
  }
  const seen = new Set<string>()
  prompts = prompts.filter((p) => {
    const k = p.text.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (prompts.length === 0) return errorResult(ErrorCode.INVALID_INPUT, 'A tracker needs at least one prompt.', 'Pass prompts (see ai_visibility_prompts_generate).')

  const tracker: Tracker = {
    id,
    site,
    prompts,
    models: input.models ?? existing?.models ?? DEFAULT_MODELS,
    brand_terms: input.brand_terms ?? existing?.brand_terms ?? (ctx.brand_name ? [ctx.brand_name] : []),
    competitors: normalizeCompetitors(input.competitors ?? existing?.competitors ?? ctx.competitors),
    location_code: input.location_code ?? existing?.location_code ?? 2840,
    language_code: input.language_code ?? existing?.language_code ?? 'en',
    created_at: existing?.created_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  }
  saveTracker(store, tracker)
  return {
    success: true,
    tracker,
    requests_per_run: tracker.prompts.length * tracker.models.length,
    next_step: 'Check the cost with ai_visibility_estimate, then run ai_visibility_run.',
  }
}

export const aiVisibilityTrackerSaveSpec = native({
  tool: {
    name: 'ai_visibility_tracker_save',
    description:
      'Use to create or edit the saved AI-visibility prompt set for a site (OpenSEO save_ai_visibility_tracker): prompts with tags, engines, brand terms, ' +
      'competitors (default: project context), location and language. `prompts` replaces the set; add_prompts / remove_prompts patch it. Free, local state only.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        tracker_id: { type: 'string', default: DEFAULT_TRACKER_ID, description: 'Name of the prompt set (default "default")' },
        prompts: {
          type: 'array',
          items: { type: 'object', properties: { text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } },
          description: 'Replace the prompt set: strings or {text, tags}',
        },
        add_prompts: { type: 'array', items: { type: 'object' }, description: 'Prompts to add: strings or {text, tags}' },
        remove_prompts: { type: 'array', items: { type: 'string' }, description: 'Prompt texts to remove' },
        models: { type: 'array', items: { type: 'string', enum: [...MODEL_IDS] }, description: `Engines (default ${DEFAULT_MODELS.join(', ')})` },
        brand_terms: { type: 'array', items: { type: 'string' }, description: 'Names that count as a brand mention besides the domain' },
        competitors: {
          type: 'array',
          items: { type: 'object', required: ['domain'], properties: { domain: { type: 'string' }, name: { type: 'string' } } },
          description: 'Competitors to watch (default: project context competitors)',
        },
        location_code: { type: 'number', description: 'DataForSEO location code (default 2840, United States)' },
        language_code: { type: 'string', description: 'Language code (default en)' },
        ...stateProps,
      },
    },
    annotations: { title: 'Save AI-visibility tracker', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  schema: trackerSaveInputSchema,
  run: wrap(runTrackerSave),
})

// ============================================================================
// ai_visibility_results
// ============================================================================

export const resultsInputSchema = z.object({
  site: z.string().min(1),
  run_id: z.string().optional(),
  model: z.enum(MODEL_IDS).optional(),
  only: z.enum(['all', 'mentioned', 'not_mentioned', 'cited', 'errors']).optional().default('all'),
  ...stateZod,
})

export function runResults(input: z.infer<typeof resultsInputSchema>) {
  const site = siteKey(input.site)
  const run = loadRun(storeFor(input), site, input.run_id)
  const rows = run.results.filter((r) => {
    if (input.model && r.model !== input.model) return false
    switch (input.only) {
      case 'mentioned':
        return r.mentioned
      case 'not_mentioned':
        return r.available && !r.mentioned && !r.error
      case 'cited':
        return r.cited
      case 'errors':
        return Boolean(r.error)
      default:
        return true
    }
  })
  return {
    success: true,
    site,
    run_id: run.id,
    date: run.started_at,
    models: run.models,
    competitors: run.competitors.map((c) => c.domain),
    summary: input.model ? run.summary.filter((s) => s.model === input.model) : run.summary,
    results: rows,
    cost_usd: run.cost_usd,
  }
}

export const aiVisibilityResultsSpec = native({
  tool: {
    name: 'ai_visibility_results',
    description:
      'Use to read a stored AI-visibility run (newest by default): per prompt × engine whether the brand is mentioned, its rank among tracked competitors, ' +
      'whether the site is cited and which URLs, and which competitors appear; plus per-engine summary (OpenSEO get_ai_visibility_results). Free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        run_id: { type: 'string', description: 'Run to read (default: newest)' },
        model: { type: 'string', enum: [...MODEL_IDS], description: 'Only this engine' },
        only: { type: 'string', enum: ['all', 'mentioned', 'not_mentioned', 'cited', 'errors'], default: 'all', description: 'Row filter' },
        ...stateProps,
      },
    },
    annotations: { title: 'AI-visibility run results', readOnlyHint: true, openWorldHint: false },
  },
  schema: resultsInputSchema,
  run: wrap(runResults),
})

// ============================================================================
// ai_visibility_trend
// ============================================================================

export const trendInputSchema = z.object({
  site: z.string().min(1),
  model: z.enum(MODEL_IDS).optional(),
  tracker_id: z.string().optional(),
  runs: z.number().int().min(2).max(200).optional().default(26),
  ...stateZod,
})

export function runTrend(input: z.infer<typeof trendInputSchema>) {
  const site = siteKey(input.site)
  const runs = loadRuns(storeFor(input), site).filter((r) => !input.tracker_id || r.tracker_id === input.tracker_id).slice(0, input.runs)
  if (runs.length === 0) return errorResult(ErrorCode.NOT_FOUND, `No AI-visibility runs for ${site} yet.`, 'Run ai_visibility_run first.')
  return {
    success: true,
    site,
    runs: runs.map((r) => ({ run_id: r.id, date: r.started_at, tracker_id: r.tracker_id, prompts: r.prompt_count, cost_usd: r.cost_usd })),
    trend: trend(runs, input.model),
    note: runs.length < 2 ? 'Only one run so far: the trend needs at least two.' : undefined,
  }
}

export const aiVisibilityTrendSpec = native({
  tool: {
    name: 'ai_visibility_trend',
    description:
      'Use to see whether AI visibility is improving: mention rate, citation rate, average mention rank and share of voice vs competitors per engine across stored runs, ' +
      'oldest to newest, with the change from first to last (OpenSEO get_ai_visibility_trend). Free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        model: { type: 'string', enum: [...MODEL_IDS], description: 'Only this engine' },
        tracker_id: { type: 'string', description: 'Only runs of this tracker' },
        runs: { type: 'number', default: 26, description: 'Newest runs to include (2-200)' },
        ...stateProps,
      },
    },
    annotations: { title: 'AI-visibility trend', readOnlyHint: true, openWorldHint: false },
  },
  schema: trendInputSchema,
  run: wrap(runTrend),
})

// ============================================================================
// ai_visibility_sources
// ============================================================================

export const sourcesInputSchema = z.object({
  site: z.string().min(1),
  run_id: z.string().optional(),
  scope: z.enum(['latest', 'all']).optional().default('latest'),
  by: z.enum(['domain', 'url']).optional().default('domain'),
  limit: z.number().int().min(1).max(500).optional().default(30),
  ...stateZod,
})

export function runSources(input: z.infer<typeof sourcesInputSchema>) {
  const site = siteKey(input.site)
  const store = storeFor(input)
  const runs = input.run_id || input.scope === 'latest' ? [loadRun(store, site, input.run_id)] : loadRuns(store, site)
  if (runs.length === 0) return errorResult(ErrorCode.NOT_FOUND, `No AI-visibility runs for ${site} yet.`)
  const competitors = runs[0].competitors
  const rows = topSources(runs, site, competitors, input.by, input.limit)
  return {
    success: true,
    site,
    runs: runs.map((r) => r.id),
    by: input.by,
    sources: rows,
    own_citations: rows.filter((r) => r.is_own).reduce((a, r) => a + r.citations, 0),
  }
}

export const aiVisibilitySourcesSpec = native({
  tool: {
    name: 'ai_visibility_sources',
    description:
      'Use to see which sites and pages AI answers cite for the tracked prompts (OpenSEO get_ai_visibility_sources): top cited domains or URLs across the latest run or all runs, ' +
      'with citation count, prompts and engines, and flags for your own site and tracked competitors. Shows where to earn mentions. Free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        run_id: { type: 'string', description: 'One run (default: newest)' },
        scope: { type: 'string', enum: ['latest', 'all'], default: 'latest', description: 'latest run or all stored runs' },
        by: { type: 'string', enum: ['domain', 'url'], default: 'domain', description: 'Group by domain or full URL' },
        limit: { type: 'number', default: 30, description: 'Rows returned (1-500)' },
        ...stateProps,
      },
    },
    annotations: { title: 'Sources cited by AI answers', readOnlyHint: true, openWorldHint: false },
  },
  schema: sourcesInputSchema,
  run: wrap(runSources),
})

// ============================================================================
// ai_visibility_answer
// ============================================================================

export const answerInputSchema = z.object({
  site: z.string().min(1),
  run_id: z.string().optional(),
  prompt: z.string().min(1).describe('Prompt text (exact, case-insensitive) or its 1-based index in the run'),
  model: z.enum(MODEL_IDS),
  ...stateZod,
})

export function runAnswer(input: z.infer<typeof answerInputSchema>) {
  const site = siteKey(input.site)
  const run = loadRun(storeFor(input), site, input.run_id)
  const prompts = [...new Set(run.answers.map((a) => a.prompt))]
  const idx = /^\d+$/.test(input.prompt) ? Number(input.prompt) - 1 : -1
  const promptText = idx >= 0 && idx < prompts.length ? prompts[idx] : prompts.find((p) => p.toLowerCase() === input.prompt.trim().toLowerCase())
  const answer = run.answers.find((a) => a.prompt === promptText && a.model === input.model)
  if (!answer) {
    return errorResult(ErrorCode.NOT_FOUND, `No ${input.model} answer for "${input.prompt}" in run ${run.id}.`, `Prompts in this run: ${prompts.slice(0, 20).join(' | ')}`)
  }
  return {
    success: true,
    site,
    run_id: run.id,
    answer,
    analysis: analyzeAnswer(answer, { site, terms: run.brand_terms }, run.competitors),
    engine: MODELS[answer.model as ModelId].label,
  }
}

export const aiVisibilityAnswerSpec = native({
  tool: {
    name: 'ai_visibility_answer',
    description:
      'Use to read the full stored answer one engine gave to one tracked prompt, with its sources and the mention/citation analysis (OpenSEO get_ai_visibility_answer). Free.',
    inputSchema: {
      type: 'object',
      required: ['site', 'prompt', 'model'],
      properties: {
        ...siteProp,
        run_id: { type: 'string', description: 'Run (default: newest)' },
        prompt: { type: 'string', description: 'Prompt text (exact, case-insensitive) or its 1-based index' },
        model: { type: 'string', enum: [...MODEL_IDS], description: 'Engine' },
        ...stateProps,
      },
    },
    annotations: { title: 'Stored AI answer', readOnlyHint: true, openWorldHint: false },
  },
  schema: answerInputSchema,
  run: wrap(runAnswer),
})

// ============================================================================
// ai_visibility_export
// ============================================================================

export const exportInputSchema = z.object({
  site: z.string().min(1),
  run_id: z.string().optional(),
  scope: z.enum(['latest', 'all']).optional().default('latest'),
  format: z.enum(['csv', 'json']).optional().default('csv'),
  write: z.boolean().optional().default(false).describe('Also write the file under <state_dir>/exports/<site>/'),
  ...stateZod,
})

export function runExport(input: z.infer<typeof exportInputSchema>) {
  const site = siteKey(input.site)
  const stateDir = resolveStateDir({ stateDir: input.state_dir, config: input.config })
  const store = new StateStore(stateDir)
  const runs = input.run_id || input.scope === 'latest' ? [loadRun(store, site, input.run_id)] : loadRuns(store, site)
  if (runs.length === 0) return errorResult(ErrorCode.NOT_FOUND, `No AI-visibility runs for ${site} yet.`)
  const rows = exportRows(runs)
  const content = input.format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2) + '\n'
  let path: string | null = null
  if (input.write) {
    const name = `ai-visibility-${input.run_id ? safeId(input.run_id) : input.scope === 'all' ? 'all' : runs[0].id}.${input.format}`
    const dir = join(stateDir, 'exports', site)
    path = join(dir, name)
    if (input.format === 'json') atomicWriteJson(path, rows)
    else {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, content, { mode: 0o600 })
    }
  }
  return { success: true, site, runs: runs.map((r) => r.id), format: input.format, rows: rows.length, path, content }
}

export const aiVisibilityExportSpec = native({
  tool: {
    name: 'ai_visibility_export',
    description:
      'Use to export AI-visibility results (latest run or all runs) as CSV or JSON, one row per prompt × engine with mention, rank, citation, competitors and sources ' +
      '(OpenSEO export_ai_visibility_data). Returns the text; write: true also saves it under <state_dir>/exports/<site>/. Free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteProp,
        run_id: { type: 'string', description: 'One run (default: newest)' },
        scope: { type: 'string', enum: ['latest', 'all'], default: 'latest', description: 'latest run or all runs' },
        format: { type: 'string', enum: ['csv', 'json'], default: 'csv', description: 'Output format' },
        write: { type: 'boolean', default: false, description: 'Also write the file under the state dir' },
        ...stateProps,
      },
    },
    annotations: { title: 'Export AI-visibility data', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  schema: exportInputSchema,
  run: wrap(runExport),
})
