import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const rankedKeywordsInputSchema = z.object({
  domain: z.string().min(1).describe('Domain to inspect — yours or a competitor\'s, e.g. "rival.com"'),
  location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
  max_position: z.number().int().min(1).max(100).optional().describe('Only keywords ranking at or above this position, e.g. 10 for page one'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Max keywords to return (default 100, max 1000)'),
})

export type RankedKeywordsInput = z.infer<typeof rankedKeywordsInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface RankedKeywordRow {
  keyword: string
  position: number | null
  url: string | null
  search_volume: number | null
  /** Estimated monthly traffic from this keyword. */
  etv: number | null
}

export type RankedKeywordsResult =
  | { success: true; domain: string; total_count: number | null; results: RankedKeywordRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface RankedKeywordItem {
  keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number | null } | null } | null
  ranked_serp_element?: { serp_item?: { rank_group?: number | null; url?: string | null; etv?: number | null } | null } | null
}

interface RankedKeywordsResultRaw {
  total_count?: number | null
  items?: RankedKeywordItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runRankedKeywords(input: RankedKeywordsInput): Promise<RankedKeywordsResult> {
  const domain = normalizeDomain(input.domain)
  try {
    const { items, cost } = await dataforseoRequest<RankedKeywordsResultRaw>({
      path: 'dataforseo_labs/google/ranked_keywords/live',
      task: {
        target: domain,
        item_types: ['organic'],
        location_name: input.location_name,
        language_code: input.language_code,
        order_by: ['keyword_data.keyword_info.search_volume,desc'],
        limit: input.limit,
        ...(input.max_position !== undefined
          ? { filters: [['ranked_serp_element.serp_item.rank_group', '<=', input.max_position]] }
          : {}),
      },
    })

    const result = items[0]
    const rows = (result?.items ?? [])
      .filter((it) => it.keyword_data?.keyword)
      .map((it) => {
        const serp = it.ranked_serp_element?.serp_item
        return {
          keyword: it.keyword_data?.keyword as string,
          position: serp?.rank_group ?? null,
          url: serp?.url ?? null,
          search_volume: it.keyword_data?.keyword_info?.search_volume ?? null,
          etv: serp?.etv ?? null,
        }
      })
      .filter((r) => input.max_position === undefined || (r.position !== null && r.position <= input.max_position))

    return { success: true, domain, total_count: result?.total_count ?? null, results: rows, cost_usd: cost }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const rankedKeywordsTool = {
  name: 'ranked_keywords',
  description:
    'Use when the user wants every keyword a domain ranks for in Google organic — especially a competitor\'s, which GSC cannot show. ' +
    'Backed by DataForSEO Labs ranked_keywords — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Billed per call (~$0.01 + $0.0001 per keyword returned). ' +
    'Returns keyword, position, url, search_volume and etv (estimated traffic), highest volume first, plus total_count and cost_usd. ' +
    'For your own site prefer gsc_opportunities (real clicks); use keyword_gap to get only what a competitor has and you lack.',
  inputSchema: {
    type: 'object',
    required: ['domain'],
    properties: {
      domain: { type: 'string', description: 'Domain to inspect, e.g. "rival.com"' },
      location_name: { type: 'string', description: 'DataForSEO location name (default: "United States")', default: 'United States' },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      max_position: { type: 'number', description: 'Only keywords ranking at or above this position (e.g. 10)' },
      limit: { type: 'number', description: 'Max keywords to return (default 100, max 1000)', default: 100 },
    },
  },
  annotations: { title: 'Ranked keywords for a domain', readOnlyHint: true, openWorldHint: true },
}

export const rankedKeywordsSpec = native({
  tool: rankedKeywordsTool,
  schema: rankedKeywordsInputSchema,
  run: async (input) => {
    const output = await runRankedKeywords(input)
    return { output, isError: !output.success }
  },
})
