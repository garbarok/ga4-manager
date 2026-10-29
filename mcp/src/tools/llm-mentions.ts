import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain, sumCosts } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const llmMentionsInputSchema = z.object({
  domain: z.string().min(1).describe('Domain to look for in AI answers, e.g. "example.com" (scheme, www. and path are ignored)'),
  keywords: z.array(z.string().min(1)).min(1).max(20).describe('Queries to check (max 20 — one billed DataForSEO request each)'),
  platform: z.enum(['google', 'chat_gpt']).optional().default('google').describe('"google" (AI Overviews/AI Mode) or "chat_gpt" (default: "google")'),
  location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
  limit: z.number().int().min(1).max(100).optional().default(20).describe('AI answers to inspect per keyword (default 20, max 100)'),
})

export type LlmMentionsInput = z.infer<typeof llmMentionsInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface CitedDomain {
  domain: string
  mentions: number
}

export interface LlmMentionsRow {
  keyword: string
  /** null when DataForSEO has no AI answer data for this keyword. */
  target_mentioned: boolean | null
  answers_checked: number
  /** Source URLs from the target domain cited in those answers. */
  target_citations: string[]
  /** Domains cited across the answers, most-cited first (top 10). */
  top_cited_domains: CitedDomain[]
  error?: string
}

export type LlmMentionsResult =
  | { success: true; domain: string; platform: string; results: LlmMentionsRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface LlmSource {
  domain?: string | null
  url?: string | null
}

interface LlmMentionItem {
  answer?: string | null
  sources?: LlmSource[] | null
}

interface LlmMentionsSearchResult {
  items?: LlmMentionItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

/** Requests in flight at once — LLM Mentions tasks can take up to ~2 minutes each. */
const CONCURRENCY = 5

function matchesTarget(host: string, target: string): boolean {
  return host === target || host.endsWith(`.${target}`)
}

/** Fold the AI answers for one keyword into a mention/citation summary for the target domain. */
export function summarizeMentions(keyword: string, target: string, items: LlmMentionItem[]): LlmMentionsRow {
  if (items.length === 0) {
    return { keyword, target_mentioned: null, answers_checked: 0, target_citations: [], top_cited_domains: [] }
  }

  const counts = new Map<string, number>()
  const citations = new Set<string>()
  let mentionedInText = false

  for (const item of items) {
    for (const source of item.sources ?? []) {
      const raw = source.domain || source.url
      if (!raw) continue
      const host = normalizeDomain(raw)
      counts.set(host, (counts.get(host) ?? 0) + 1)
      if (matchesTarget(host, target)) citations.add(source.url ?? host)
    }
    if (item.answer && item.answer.toLowerCase().includes(target)) mentionedInText = true
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([domain, mentions]) => ({ domain, mentions }))

  return {
    keyword,
    target_mentioned: citations.size > 0 || mentionedInText,
    answers_checked: items.length,
    target_citations: [...citations],
    top_cited_domains: top,
  }
}

export async function runLlmMentions(input: LlmMentionsInput): Promise<LlmMentionsResult> {
  const target = normalizeDomain(input.domain)
  if (!target) return errorResult(ErrorCode.INVALID_INPUT, `"${input.domain}" is not a valid domain.`)

  const settled: PromiseSettledResult<{ row: LlmMentionsRow; cost: number | null }>[] = []
  for (let i = 0; i < input.keywords.length; i += CONCURRENCY) {
    const batch = input.keywords.slice(i, i + CONCURRENCY).map(async (keyword) => {
      const { items, cost } = await dataforseoRequest<LlmMentionsSearchResult>({
        path: 'ai_optimization/llm_mentions/search/live',
        task: {
          target: [{ keyword }],
          platform: input.platform,
          location_name: input.location_name,
          language_code: input.language_code,
          limit: input.limit,
        },
        timeoutMs: 150_000,
      })
      return { row: summarizeMentions(keyword, target, items[0]?.items ?? []), cost }
    })
    settled.push(...(await Promise.allSettled(batch)))
  }

  // If nothing succeeded, surface the first error as-is (e.g. no funds, no API access).
  if (settled.every((s) => s.status === 'rejected')) {
    const err = (settled[0] as PromiseRejectedResult).reason
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }

  const results = settled.map((s, i): LlmMentionsRow => {
    if (s.status === 'fulfilled') return s.value.row
    const message = s.reason instanceof Error ? s.reason.message : String(s.reason)
    return { keyword: input.keywords[i], target_mentioned: null, answers_checked: 0, target_citations: [], top_cited_domains: [], error: message }
  })

  return {
    success: true,
    domain: target,
    platform: input.platform,
    results,
    cost_usd: sumCosts(settled.map((s) => (s.status === 'fulfilled' ? s.value.cost : null))),
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const llmMentionsTool = {
  name: 'llm_mentions',
  description:
    'Use when the user wants to know whether AI answers (Google AI Overviews/AI Mode or ChatGPT) mention or cite a site for given queries, ' +
    'and which domains they cite instead (AI visibility, GEO, "does the AI cite us?"). ' +
    'Backed by DataForSEO AI Optimization → LLM Mentions — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD and the LLM Mentions subscription. ' +
    'Billed per keyword (roughly $0.10 each), so check few keywords at a time; call dataforseo_balance first if unsure. ' +
    'Returns per keyword: target_mentioned (null = no AI answer data), target_citations, top_cited_domains; plus cost_usd. ' +
    'Complements keyword_rank_check (which checks a single live Google AI Overview) with DataForSEO\'s aggregated AI-answer database.',
  inputSchema: {
    type: 'object',
    required: ['domain', 'keywords'],
    properties: {
      domain: { type: 'string', description: 'Domain to look for, e.g. "example.com"' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Queries to check (max 20, billed per keyword)' },
      platform: { type: 'string', enum: ['google', 'chat_gpt'], description: 'AI platform (default: "google")', default: 'google' },
      location_name: { type: 'string', description: 'DataForSEO location name (default: "United States")', default: 'United States' },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      limit: { type: 'number', description: 'AI answers to inspect per keyword (default 20, max 100)', default: 20 },
    },
  },
  annotations: { title: 'AI answer mentions for a domain', readOnlyHint: true, openWorldHint: true },
}

export const llmMentionsSpec = native({
  tool: llmMentionsTool,
  schema: llmMentionsInputSchema,
  run: async (input) => {
    const output = await runLlmMentions(input)
    return { output, isError: !output.success }
  },
})
