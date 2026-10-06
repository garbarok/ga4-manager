import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const keywordGapInputSchema = z.object({
  domain: z.string().min(1).describe('Your domain, e.g. "example.com"'),
  competitor: z.string().min(1).describe('Competitor domain to find keyword gaps against'),
  location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
  min_search_volume: z.number().int().min(0).optional().describe('Only keywords with at least this monthly search volume'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Max keywords to return (default 100, max 1000)'),
})

export type KeywordGapInput = z.infer<typeof keywordGapInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface KeywordGapRow {
  keyword: string
  search_volume: number | null
  keyword_difficulty: number | null
  competitor_position: number | null
  competitor_url: string | null
}

export type KeywordGapResult =
  | { success: true; domain: string; competitor: string; total_count: number | null; results: KeywordGapRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface SerpElement {
  rank_group?: number | null
  url?: string | null
}

interface DomainIntersectionItem {
  keyword_data?: {
    keyword?: string
    keyword_info?: { search_volume?: number | null } | null
    keyword_properties?: { keyword_difficulty?: number | null } | null
  } | null
  first_domain_serp_element?: SerpElement | null
  second_domain_serp_element?: SerpElement | null
}

interface DomainIntersectionResult {
  total_count?: number | null
  items?: DomainIntersectionItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runKeywordGap(input: KeywordGapInput): Promise<KeywordGapResult> {
  const domain = normalizeDomain(input.domain)
  const competitor = normalizeDomain(input.competitor)
  if (domain === competitor) {
    return errorResult(ErrorCode.INVALID_INPUT, `domain and competitor are the same host (${domain}).`)
  }

  try {
    const filters =
      input.min_search_volume !== undefined ? [['keyword_data.keyword_info.search_volume', '>=', input.min_search_volume]] : undefined
    // intersections:false → keywords target1 (competitor) ranks for and target2 (us) does not.
    const { items, cost } = await dataforseoRequest<DomainIntersectionResult>({
      path: 'dataforseo_labs/google/domain_intersection/live',
      task: {
        target1: competitor,
        target2: domain,
        intersections: false,
        item_types: ['organic'],
        location_name: input.location_name,
        language_code: input.language_code,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        limit: input.limit,
        ...(filters ? { filters } : {}),
      },
    })

    const result = items[0]
    const rows = (result?.items ?? [])
      // Re-check server-side semantics: drop anything where we do rank, or below the volume floor.
      .filter((it) => !it.second_domain_serp_element && it.keyword_data?.keyword)
      .map((it) => ({
        keyword: it.keyword_data?.keyword as string,
        search_volume: it.keyword_data?.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        competitor_position: it.first_domain_serp_element?.rank_group ?? null,
        competitor_url: it.first_domain_serp_element?.url ?? null,
      }))
      .filter((r) => input.min_search_volume === undefined || (r.search_volume ?? 0) >= input.min_search_volume)
      .sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1))

    return { success: true, domain, competitor, total_count: result?.total_count ?? null, results: rows, cost_usd: cost }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const keywordGapTool = {
  name: 'keyword_gap',
  description:
    'Use when the user wants keywords a competitor ranks for in Google and their own site does not (content gap, "what should we create next?"). ' +
    'Backed by DataForSEO Labs domain_intersection — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Billed per call (~$0.01 + $0.0001 per keyword returned). ' +
    'Returns keyword, search_volume, keyword_difficulty, competitor_position and competitor_url, sorted by volume; plus cost_usd. ' +
    'Pair with keyword_serp_snapshot to inspect a gap keyword\'s SERP before writing content.',
  inputSchema: {
    type: 'object',
    required: ['domain', 'competitor'],
    properties: {
      domain: { type: 'string', description: 'Your domain, e.g. "example.com"' },
      competitor: { type: 'string', description: 'Competitor domain' },
      location_name: { type: 'string', description: 'DataForSEO location name (default: "United States")', default: 'United States' },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      min_search_volume: { type: 'number', description: 'Only keywords with at least this monthly search volume' },
      limit: { type: 'number', description: 'Max keywords to return (default 100, max 1000)', default: 100 },
    },
  },
  annotations: { title: 'Keyword gap vs a competitor', readOnlyHint: true, openWorldHint: true },
}

export const keywordGapSpec = native({
  tool: keywordGapTool,
  schema: keywordGapInputSchema,
  run: async (input) => {
    const output = await runKeywordGap(input)
    return { output, isError: !output.success }
  },
})
