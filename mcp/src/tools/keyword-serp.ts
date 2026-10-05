import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoPost } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const keywordSerpSnapshotInputSchema = z.object({
  keyword: z.string().min(1).describe('The search query to snapshot'),
  location_name: z.string().optional().default('United States').describe('DataForSEO location name (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
  depth: z.number().int().min(1).max(100).optional().default(10).describe('Number of organic results to return (default 10, max 100)'),
})

export type KeywordSerpSnapshotInput = z.infer<typeof keywordSerpSnapshotInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface SerpOrganicRow {
  position: number
  url: string
  domain: string | null
  title: string | null
  description: string | null
}

export type KeywordSerpSnapshotResult =
  | { success: true; keyword: string; results: SerpOrganicRow[] }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface SerpItem {
  type: string
  rank_absolute?: number
  url?: string
  domain?: string
  title?: string
  description?: string
}

interface SerpAdvancedResult {
  keyword: string
  items?: SerpItem[] | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runKeywordSerpSnapshot(input: KeywordSerpSnapshotInput): Promise<KeywordSerpSnapshotResult> {
  try {
    const rows = await dataforseoPost<SerpAdvancedResult>('serp/google/organic/live/advanced', {
      keyword: input.keyword,
      location_name: input.location_name,
      language_code: input.language_code,
      depth: input.depth,
    })

    const result = rows[0]
    if (!result) {
      return errorResult(ErrorCode.NOT_FOUND, `DataForSEO returned no SERP data for "${input.keyword}".`)
    }

    const organic = (result.items ?? [])
      .filter((item) => item.type === 'organic' && item.url)
      .slice(0, input.depth)
      .map((item) => ({
        position: item.rank_absolute ?? 0,
        url: item.url as string,
        domain: item.domain ?? null,
        title: item.title ?? null,
        description: item.description ?? null,
      }))

    return { success: true, keyword: result.keyword, results: organic }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const keywordSerpSnapshotTool = {
  name: 'keyword_serp_snapshot',
  description:
    'Use when the user wants to see who currently ranks for a keyword (content-gap analysis, competitive research). ' +
    'Backed by the DataForSEO live Google organic SERP endpoint — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Returns ranked organic results (position, url, domain, title, description). ' +
    'Pair with keyword_volume for demand and gsc_opportunities for your own site\'s existing performance on the same query.',
  inputSchema: {
    type: 'object',
    required: ['keyword'],
    properties: {
      keyword: { type: 'string', description: 'The search query to snapshot' },
      location_name: {
        type: 'string',
        description: 'DataForSEO location name (default: "United States")',
        default: 'United States',
      },
      language_code: { type: 'string', description: 'Language code, e.g. "en", "es" (default: "en")', default: 'en' },
      depth: {
        type: 'number',
        description: 'Number of organic results to return (default 10, max 100)',
        default: 10,
      },
    },
  },
  annotations: { title: 'SERP snapshot for a keyword', readOnlyHint: true, openWorldHint: true },
}

export const keywordSerpSnapshotSpec = native({
  tool: keywordSerpSnapshotTool,
  schema: keywordSerpSnapshotInputSchema,
  run: async (input) => {
    const output = await runKeywordSerpSnapshot(input)
    return { output, isError: !output.success }
  },
})
