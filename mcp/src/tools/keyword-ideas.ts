import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const keywordIdeasInputSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(20).describe('1–20 seed keywords'),
  location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
  max_keyword_difficulty: z.number().int().min(0).max(100).optional().describe('Only ideas with keyword difficulty at or below this (0–100)'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Max ideas to return (default 100, max 1000)'),
})

export type KeywordIdeasInput = z.infer<typeof keywordIdeasInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface KeywordIdeaRow {
  keyword: string
  search_volume: number | null
  cpc: number | null
  keyword_difficulty: number | null
  search_intent: string | null
}

export type KeywordIdeasResult =
  | { success: true; total_count: number | null; results: KeywordIdeaRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface KeywordIdeaItem {
  keyword?: string
  keyword_info?: { search_volume?: number | null; cpc?: number | null } | null
  keyword_properties?: { keyword_difficulty?: number | null } | null
  search_intent_info?: { main_intent?: string | null } | null
}

interface KeywordIdeasResultRaw {
  total_count?: number | null
  items?: KeywordIdeaItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runKeywordIdeas(input: KeywordIdeasInput): Promise<KeywordIdeasResult> {
  try {
    const { items, cost } = await dataforseoRequest<KeywordIdeasResultRaw>({
      path: 'dataforseo_labs/google/keyword_ideas/live',
      task: {
        keywords: input.keywords,
        location_name: input.location_name,
        language_code: input.language_code,
        limit: input.limit,
        ...(input.max_keyword_difficulty !== undefined
          ? { filters: [['keyword_properties.keyword_difficulty', '<=', input.max_keyword_difficulty]] }
          : {}),
      },
    })

    const result = items[0]
    const rows = (result?.items ?? [])
      .filter((it) => it.keyword)
      .map((it) => ({
        keyword: it.keyword as string,
        search_volume: it.keyword_info?.search_volume ?? null,
        cpc: it.keyword_info?.cpc ?? null,
        keyword_difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        search_intent: it.search_intent_info?.main_intent ?? null,
      }))
      .filter(
        (r) =>
          input.max_keyword_difficulty === undefined ||
          r.keyword_difficulty === null ||
          r.keyword_difficulty <= input.max_keyword_difficulty,
      )

    return { success: true, total_count: result?.total_count ?? null, results: rows, cost_usd: cost }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const keywordIdeasTool = {
  name: 'keyword_ideas',
  description:
    'Use when the user wants new keyword ideas around seed topics, with difficulty and intent, to choose what to create next. ' +
    'Backed by DataForSEO Labs keyword_ideas — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Billed per call (~$0.01 + $0.0001 per idea returned). ' +
    'Returns keyword, search_volume, cpc, keyword_difficulty (0–100) and search_intent (informational/navigational/commercial/transactional), each null when unknown; plus cost_usd. ' +
    'Use keyword_volume instead when you already know the exact keywords.',
  inputSchema: {
    type: 'object',
    required: ['keywords'],
    properties: {
      keywords: { type: 'array', items: { type: 'string' }, description: '1–20 seed keywords' },
      location_name: { type: 'string', description: 'DataForSEO location name (default: "United States")', default: 'United States' },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      max_keyword_difficulty: { type: 'number', description: 'Only ideas with keyword difficulty at or below this (0–100)' },
      limit: { type: 'number', description: 'Max ideas to return (default 100, max 1000)', default: 100 },
    },
  },
  annotations: { title: 'Keyword ideas with difficulty and intent', readOnlyHint: true, openWorldHint: true },
}

export const keywordIdeasSpec = native({
  tool: keywordIdeasTool,
  schema: keywordIdeasInputSchema,
  run: async (input) => {
    const output = await runKeywordIdeas(input)
    return { output, isError: !output.success }
  },
})
