import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const keywordVolumeInputSchema = z.object({
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .describe('Keywords to look up (max 200 per call — DataForSEO Google Ads search volume endpoint limit)'),
  location_name: z
    .string()
    .optional()
    .default('United States')
    .describe('DataForSEO location name, e.g. "United States", "Spain" (default: "United States")'),
  language_code: z.string().optional().default('en').describe('Language code, e.g. "en", "es" (default: "en")'),
})

export type KeywordVolumeInput = z.infer<typeof keywordVolumeInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface KeywordVolumeRow {
  keyword: string
  search_volume: number | null
  cpc: number | null
  competition: string | null
  competition_index: number | null
}

export type KeywordVolumeResult =
  | { success: true; results: KeywordVolumeRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface SearchVolumeResult {
  keyword: string
  search_volume?: number | null
  cpc?: number | null
  competition?: string | null
  competition_index?: number | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runKeywordVolume(input: KeywordVolumeInput): Promise<KeywordVolumeResult> {
  try {
    const { items: rows, cost } = await dataforseoRequest<SearchVolumeResult>({
      path: 'keywords_data/google_ads/search_volume/live',
      task: {
        keywords: input.keywords,
        location_name: input.location_name,
        language_code: input.language_code,
      },
    })

    if (rows.length === 0) {
      return errorResult(ErrorCode.NOT_FOUND, 'DataForSEO returned no search-volume data for these keywords.')
    }

    return {
      success: true,
      results: rows.map((r) => ({
        keyword: r.keyword,
        search_volume: r.search_volume ?? null,
        cpc: r.cpc ?? null,
        competition: r.competition ?? null,
        competition_index: r.competition_index ?? null,
      })),
      cost_usd: cost,
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const keywordVolumeTool = {
  name: 'keyword_volume',
  description:
    'Use when the user wants monthly search volume, CPC, or competition for a list of keywords (keyword research, content planning). ' +
    'Backed by the DataForSEO Google Ads search-volume endpoint — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Returns per-keyword search_volume, cpc, competition and competition_index, plus cost_usd (billed per call, ~$0.075). ' +
    'Complements gsc_opportunities (which reports actual clicks/impressions) with pre-ranking demand estimates for keywords you do not yet rank for.',
  inputSchema: {
    type: 'object',
    required: ['keywords'],
    properties: {
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords to look up (max 200 per call)',
      },
      location_name: {
        type: 'string',
        description: 'DataForSEO location name, e.g. "United States", "Spain" (default: "United States")',
        default: 'United States',
      },
      language_code: {
        type: 'string',
        description: 'Language code, e.g. "en", "es" (default: "en")',
        default: 'en',
      },
    },
  },
  annotations: { title: 'Keyword search volume', readOnlyHint: true, openWorldHint: true },
}

export const keywordVolumeSpec = native({
  tool: keywordVolumeTool,
  schema: keywordVolumeInputSchema,
  run: async (input) => {
    const output = await runKeywordVolume(input)
    return { output, isError: !output.success }
  },
})
