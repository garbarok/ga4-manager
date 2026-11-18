import { StateStore, siteKey, safeId } from '../../utils/state-store.js'
import { ToolError, ErrorCode } from '../../utils/errors.js'
import { normalizeDomain } from '../../utils/dataforseo-client.js'
import { domainMatches, summarize, type Entity, type ModelSummary, type PromptModelResult } from './detect.js'
import type { AnswerRecord, ModelId } from './models.js'

/**
 * Persistence for AI-visibility tracking (ADR-0006 collections):
 *   ai-visibility-trackers/<site>/<tracker_id>.json   the saved prompt set
 *   ai-visibility-runs/<site>/<run_id>.json           one run across models
 * Plus the pure aggregates over stored runs: trend, sources, export.
 */

export const TRACKERS = 'ai-visibility-trackers'
export const RUNS = 'ai-visibility-runs'
export const DEFAULT_TRACKER_ID = 'default'

export interface TrackedPrompt {
  text: string
  tags: string[]
}

export interface Tracker {
  id: string
  site: string
  prompts: TrackedPrompt[]
  models: ModelId[]
  /** Terms that count as a brand mention besides the site domain. */
  brand_terms: string[]
  competitors: Entity[]
  location_code: number
  language_code: string
  created_at: string
  updated_at: string
}

export interface Run {
  id: string
  site: string
  tracker_id: string
  started_at: string
  finished_at: string
  models: ModelId[]
  location_code: number
  language_code: string
  brand_terms: string[]
  competitors: Entity[]
  prompt_count: number
  cost_usd: number | null
  summary: ModelSummary[]
  results: PromptModelResult[]
  answers: AnswerRecord[]
}

export function loadTracker(store: StateStore, site: string, id: string = DEFAULT_TRACKER_ID): Tracker | null {
  return store.readRecord<Tracker>(TRACKERS, site, safeId(id))?.data ?? null
}

export function requireTracker(store: StateStore, site: string, id: string = DEFAULT_TRACKER_ID): Tracker {
  const t = loadTracker(store, site, id)
  if (!t) {
    throw new ToolError(
      ErrorCode.NOT_FOUND,
      `No AI-visibility tracker "${id}" for ${siteKey(site)}.`,
      'Create one with ai_visibility_tracker_save (prompts from ai_visibility_prompts_generate or ai_visibility_research).',
    )
  }
  return t
}

export function saveTracker(store: StateStore, tracker: Tracker): Tracker {
  store.writeRecord(TRACKERS, tracker.site, safeId(tracker.id), tracker)
  return tracker
}

export function saveRun(store: StateStore, run: Run): Run {
  store.writeRecord(RUNS, run.site, run.id, run)
  return run
}

/** Runs newest first; `limit` caps how many are read. */
export function loadRuns(store: StateStore, site: string, limit = Infinity): Run[] {
  return store
    .listRecordIds(RUNS, site)
    .slice(0, limit)
    .map((id) => store.readRecord<Run>(RUNS, site, id)?.data)
    .filter((r): r is Run => Boolean(r))
}

export function loadRun(store: StateStore, site: string, runId?: string): Run {
  if (runId) {
    const r = store.readRecord<Run>(RUNS, site, safeId(runId))?.data
    if (!r) throw new ToolError(ErrorCode.NOT_FOUND, `No AI-visibility run "${runId}" for ${siteKey(site)}.`, 'List runs with ai_visibility_trend.')
    return r
  }
  const [latest] = loadRuns(store, site, 1)
  if (!latest) {
    throw new ToolError(ErrorCode.NOT_FOUND, `No AI-visibility runs for ${siteKey(site)} yet.`, 'Run ai_visibility_run (check the cost first with ai_visibility_estimate).')
  }
  return latest
}

export { summarize }

// ============================================================================
// Trend
// ============================================================================

export interface TrendPoint {
  run_id: string
  date: string
  model: ModelId
  answered: number
  mention_rate: number | null
  citation_rate: number | null
  avg_mention_rank: number | null
  brand_share_of_voice: number | null
  competitor_share_of_voice: Record<string, number>
}

/** Oldest → newest per model, so a chart reads left to right. */
export function trend(runs: Run[], model?: ModelId): { model: ModelId; points: TrendPoint[]; change: { mention_rate: number | null; citation_rate: number | null } }[] {
  const byModel = new Map<ModelId, TrendPoint[]>()
  for (const run of [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    for (const s of run.summary) {
      if (model && s.model !== model) continue
      const brand = s.share_of_voice.find((x) => x.is_brand)
      const point: TrendPoint = {
        run_id: run.id,
        date: run.started_at.slice(0, 10),
        model: s.model,
        answered: s.answered,
        mention_rate: s.mention_rate,
        citation_rate: s.citation_rate,
        avg_mention_rank: s.avg_mention_rank,
        brand_share_of_voice: brand ? brand.share : null,
        competitor_share_of_voice: Object.fromEntries(s.share_of_voice.filter((x) => !x.is_brand).map((x) => [x.entity, x.share])),
      }
      byModel.set(s.model, [...(byModel.get(s.model) ?? []), point])
    }
  }
  return [...byModel.entries()].map(([m, points]) => {
    const first = points[0]
    const last = points[points.length - 1]
    const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 1000) / 1000)
    return {
      model: m,
      points,
      change: points.length < 2 ? { mention_rate: null, citation_rate: null } : { mention_rate: diff(first.mention_rate, last.mention_rate), citation_rate: diff(first.citation_rate, last.citation_rate) },
    }
  })
}

// ============================================================================
// Sources
// ============================================================================

export interface SourceRow {
  key: string
  citations: number
  /** Distinct prompts whose answers cite it. */
  prompts: number
  models: ModelId[]
  is_own: boolean
  competitor: string | null
}

export function topSources(
  runs: Run[],
  site: string,
  competitors: Entity[],
  by: 'domain' | 'url',
  limit: number,
): SourceRow[] {
  const rows = new Map<string, { citations: number; prompts: Set<string>; models: Set<ModelId>; domain: string | null }>()
  for (const run of runs) {
    for (const a of run.answers) {
      for (const s of a.sources) {
        // Without a domain, group by the engine's source name so the citation stays visible.
        const key = by === 'domain' ? s.domain ?? (s.source_name ? `${s.source_name} (no domain)` : '(unnamed source)') : s.url
        const row = rows.get(key) ?? { citations: 0, prompts: new Set(), models: new Set(), domain: s.domain }
        row.citations += 1
        row.prompts.add(a.prompt)
        row.models.add(a.model)
        rows.set(key, row)
      }
    }
  }
  return [...rows.entries()]
    .map(([key, r]) => ({
      key,
      citations: r.citations,
      prompts: r.prompts.size,
      models: [...r.models].sort(),
      is_own: domainMatches(r.domain, site),
      competitor: competitors.find((c) => domainMatches(r.domain, c.domain))?.domain ?? null,
    }))
    .sort((a, b) => b.citations - a.citations || b.prompts - a.prompts || a.key.localeCompare(b.key))
    .slice(0, limit)
}

// ============================================================================
// Export
// ============================================================================

export const EXPORT_COLUMNS = [
  'run_id', 'date', 'model', 'prompt', 'available', 'mentioned', 'mention_rank', 'cited', 'cited_urls',
  'competitors_mentioned', 'competitors_cited', 'source_count', 'sources', 'error',
] as const

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportRows(runs: Run[]): Record<(typeof EXPORT_COLUMNS)[number], unknown>[] {
  const rows: Record<(typeof EXPORT_COLUMNS)[number], unknown>[] = []
  for (const run of runs) {
    for (const r of run.results) {
      const answer = run.answers.find((a) => a.prompt === r.prompt && a.model === r.model)
      rows.push({
        run_id: run.id,
        date: run.started_at.slice(0, 10),
        model: r.model,
        prompt: r.prompt,
        available: r.available,
        mentioned: r.mentioned,
        mention_rank: r.mention_rank,
        cited: r.cited,
        cited_urls: r.cited_urls.join(' '),
        competitors_mentioned: r.competitors.filter((c) => c.mentioned).map((c) => c.domain).join(' '),
        competitors_cited: r.competitors.filter((c) => c.cited).map((c) => c.domain).join(' '),
        source_count: r.source_count,
        sources: (answer?.sources ?? []).map((s) => s.domain ?? s.url).join(' '),
        error: r.error ?? '',
      })
    }
  }
  return rows
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const lines = [EXPORT_COLUMNS.join(',')]
  for (const row of rows) lines.push(EXPORT_COLUMNS.map((c) => csvCell(row[c])).join(','))
  return lines.join('\n') + '\n'
}

export function normalizeCompetitors(list: Entity[]): Entity[] {
  const seen = new Set<string>()
  const out: Entity[] = []
  for (const c of list) {
    const domain = normalizeDomain(c.domain)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    out.push({ domain, ...(c.name ? { name: c.name } : {}) })
  }
  return out
}
