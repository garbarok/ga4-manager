import { z } from 'zod'
import { native } from '../tool-spec.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { siteStateProperties, siteStateShape, storeFor, guard } from '../utils/site-input.js'
import { siteKey, type StateStore } from '../utils/state-store.js'
import { normalizeKeyword } from './rank-tracker-core.js'

/**
 * Saved, tagged keyword lists per site (OpenSEO save_keywords /
 * list_saved_keywords). One snapshot per site: `keywords.<site>.json`.
 * Saving is an upsert: tags are merged, a note or metrics replace the old ones.
 */

export const KEYWORDS_COMMAND = 'keywords'
export const MAX_SAVED_KEYWORDS = 5000

export interface KeywordMetrics {
  volume?: number | null
  kd?: number | null
  cpc?: number | null
  captured_at: string
}

export interface SavedKeyword {
  keyword: string
  tags: string[]
  note?: string
  added_at: string
  updated_at: string
  metrics?: KeywordMetrics
}

export interface KeywordWorkspace {
  site: string
  keywords: SavedKeyword[]
}

function normTag(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, '-')
}

export function loadWorkspace(store: StateStore, site: string): KeywordWorkspace {
  const snap = store.readSnapshot<KeywordWorkspace>(KEYWORDS_COMMAND, site)
  return snap?.data ?? { site: siteKey(site), keywords: [] }
}

export function saveWorkspace(store: StateStore, ws: KeywordWorkspace, now: Date = new Date()): void {
  store.writeSnapshot(KEYWORDS_COMMAND, ws.site, ws, now)
}

/** Saved keywords, optionally only those carrying `tag`. */
export function savedKeywords(store: StateStore, site: string, tag?: string): string[] {
  const t = tag ? normTag(tag) : null
  return loadWorkspace(store, site)
    .keywords.filter((k) => !t || k.tags.includes(t))
    .map((k) => k.keyword)
}

export interface SaveInput {
  keywords: string[]
  tags?: string[]
  note?: string
  metrics?: Record<string, { volume?: number | null; kd?: number | null; cpc?: number | null }>
  replace_tags?: boolean
}

export function upsertKeywords(ws: KeywordWorkspace, input: SaveInput, now: Date = new Date()): { ws: KeywordWorkspace; added: string[]; updated: string[] } {
  const at = now.toISOString()
  const tags = (input.tags ?? []).map(normTag).filter(Boolean)
  const metrics = new Map(Object.entries(input.metrics ?? {}).map(([k, v]) => [normalizeKeyword(k), v]))
  const byKey = new Map(ws.keywords.map((k) => [k.keyword, { ...k, tags: [...k.tags] }]))
  const added: string[] = []
  const updated: string[] = []
  for (const raw of input.keywords) {
    const keyword = normalizeKeyword(raw)
    if (!keyword) continue
    const existing = byKey.get(keyword)
    const m = metrics.get(keyword)
    const next: SavedKeyword = existing ?? { keyword, tags: [], added_at: at, updated_at: at }
    next.tags = [...new Set([...(input.replace_tags ? [] : next.tags), ...tags])].sort()
    if (input.note !== undefined) next.note = input.note
    if (m) next.metrics = { volume: m.volume ?? null, kd: m.kd ?? null, cpc: m.cpc ?? null, captured_at: at }
    next.updated_at = at
    if (existing) updated.push(keyword)
    else added.push(keyword)
    byKey.set(keyword, next)
  }
  if (byKey.size > MAX_SAVED_KEYWORDS) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `A site holds at most ${MAX_SAVED_KEYWORDS} saved keywords (would have ${byKey.size}).`)
  }
  return { ws: { ...ws, keywords: [...byKey.values()] }, added, updated }
}

export function tagCounts(ws: KeywordWorkspace): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const k of ws.keywords) for (const t of k.tags) counts[t] = (counts[t] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

// ============================================================================
// keywords_save
// ============================================================================

const metricsShape = z.record(
  z.string(),
  z.object({ volume: z.number().nullable().optional(), kd: z.number().nullable().optional(), cpc: z.number().nullable().optional() }),
)

export const keywordsSaveSchema = z.object({
  ...siteStateShape,
  keywords: z.array(z.string().min(1)).min(1).max(1000),
  tags: z.array(z.string().min(1)).optional(),
  note: z.string().optional(),
  metrics: metricsShape.optional(),
  replace_tags: z.boolean().optional().default(false),
})

export async function runKeywordsSave(input: z.infer<typeof keywordsSaveSchema>, now = new Date()) {
  return guard(() => {
    const store = storeFor(input)
    const { ws, added, updated } = upsertKeywords(loadWorkspace(store, input.site), input, now)
    saveWorkspace(store, ws, now)
    return { success: true as const, site: ws.site, added, updated, total: ws.keywords.length, tags: tagCounts(ws) }
  })
}

export const keywordsSaveSpec = native({
  tool: {
    name: 'keywords_save',
    description:
      'Use to save keywords to a site\'s keyword workspace so later sessions and agents reuse them (OpenSEO save_keywords). ' +
      'Upsert: existing keywords keep their tags and gain the new ones (replace_tags: true replaces them); note and metrics replace old values. ' +
      'Pass metrics you already bought (from keyword_volume / keyword_ideas) as {keyword: {volume, kd, cpc}} so nobody buys them again. Local, free.',
    inputSchema: {
      type: 'object',
      required: ['site', 'keywords'],
      properties: {
        ...siteStateProperties,
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to save (normalized to lowercase, single spaces)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for these keywords, e.g. ["pricing", "cluster-a"]' },
        note: { type: 'string', description: 'Note stored on each keyword' },
        metrics: {
          type: 'object',
          description: 'Optional metrics per keyword: {"keyword": {"volume": 1200, "kd": 35, "cpc": 1.2}}',
          additionalProperties: { type: 'object', properties: { volume: { type: 'number' }, kd: { type: 'number' }, cpc: { type: 'number' } } },
        },
        replace_tags: { type: 'boolean', description: 'Replace existing tags instead of merging (default false)', default: false },
      },
    },
    annotations: { title: 'Save keywords', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  schema: keywordsSaveSchema,
  run: async (input) => {
    const output = await runKeywordsSave(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// keywords_list
// ============================================================================

export const keywordsListSchema = z.object({
  ...siteStateShape,
  tag: z.string().optional(),
  query: z.string().optional(),
  sort: z.enum(['keyword', 'added_at', 'volume']).optional().default('keyword'),
  limit: z.number().int().min(1).max(MAX_SAVED_KEYWORDS).optional().default(500),
})

export async function runKeywordsList(input: z.infer<typeof keywordsListSchema>) {
  return guard(() => {
    const store = storeFor(input)
    const ws = loadWorkspace(store, input.site)
    const tag = input.tag ? normTag(input.tag) : null
    const q = input.query?.trim().toLowerCase()
    const filtered = ws.keywords.filter((k) => (!tag || k.tags.includes(tag)) && (!q || k.keyword.includes(q)))
    const sorted = [...filtered].sort((a, b) => {
      if (input.sort === 'added_at') return b.added_at.localeCompare(a.added_at) || a.keyword.localeCompare(b.keyword)
      if (input.sort === 'volume') return (b.metrics?.volume ?? -1) - (a.metrics?.volume ?? -1) || a.keyword.localeCompare(b.keyword)
      return a.keyword.localeCompare(b.keyword)
    })
    return {
      success: true as const,
      site: ws.site,
      total: ws.keywords.length,
      matched: filtered.length,
      tags: tagCounts(ws),
      keywords: sorted.slice(0, input.limit),
    }
  })
}

export const keywordsListSpec = native({
  tool: {
    name: 'keywords_list',
    description:
      'Use to read a site\'s saved keywords (OpenSEO list_saved_keywords), optionally filtered by tag or substring, sorted by keyword, added_at or volume. ' +
      'Returns the keywords with tags, notes and stored metrics, plus tag counts. Local, free.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        tag: { type: 'string', description: 'Only keywords with this tag' },
        query: { type: 'string', description: 'Only keywords containing this text' },
        sort: { type: 'string', enum: ['keyword', 'added_at', 'volume'], description: 'Sort order (default keyword)', default: 'keyword' },
        limit: { type: 'number', description: 'Max keywords returned (default 500)', default: 500 },
      },
    },
    annotations: { title: 'List saved keywords', readOnlyHint: true, openWorldHint: false },
  },
  schema: keywordsListSchema,
  run: async (input) => {
    const output = await runKeywordsList(input)
    return { output, isError: !output.success }
  },
})

// ============================================================================
// keywords_remove
// ============================================================================

export const keywordsRemoveSchema = z
  .object({
    ...siteStateShape,
    keywords: z.array(z.string().min(1)).optional(),
    tag: z.string().optional(),
    untag: z.string().optional(),
  })
  .refine((d) => d.keywords?.length || d.tag || d.untag, { error: 'Pass keywords, tag (remove every keyword with it) or untag (strip that tag)' })

export async function runKeywordsRemove(input: z.infer<typeof keywordsRemoveSchema>, now = new Date()) {
  return guard(() => {
    const store = storeFor(input)
    const ws = loadWorkspace(store, input.site)
    const drop = new Set((input.keywords ?? []).map(normalizeKeyword))
    const tag = input.tag ? normTag(input.tag) : null
    const untag = input.untag ? normTag(input.untag) : null
    const removed: string[] = []
    let untagged = 0
    const kept: SavedKeyword[] = []
    for (const k of ws.keywords) {
      if (drop.has(k.keyword) || (tag && k.tags.includes(tag))) {
        removed.push(k.keyword)
        continue
      }
      if (untag && k.tags.includes(untag)) {
        untagged += 1
        kept.push({ ...k, tags: k.tags.filter((t) => t !== untag), updated_at: now.toISOString() })
      } else kept.push(k)
    }
    const next = { ...ws, keywords: kept }
    saveWorkspace(store, next, now)
    return { success: true as const, site: ws.site, removed, untagged, total: kept.length, tags: tagCounts(next) }
  })
}

export const keywordsRemoveSpec = native({
  tool: {
    name: 'keywords_remove',
    description:
      'Use to remove saved keywords: by name (keywords), every keyword with a tag (tag), or strip a tag but keep the keywords (untag). Local only.',
    inputSchema: {
      type: 'object',
      required: ['site'],
      properties: {
        ...siteStateProperties,
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to remove' },
        tag: { type: 'string', description: 'Remove every keyword carrying this tag' },
        untag: { type: 'string', description: 'Strip this tag from every keyword (keywords stay)' },
      },
    },
    annotations: { title: 'Remove saved keywords', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  schema: keywordsRemoveSchema,
  run: async (input) => {
    const output = await runKeywordsRemove(input)
    return { output, isError: !output.success }
  },
})
