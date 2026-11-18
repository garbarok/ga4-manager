import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { resultHost, resultUrl } from '../utils/serp-host.js'
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
  /** The page URL; null when Google served the result through a google.com/goto redirect (see url_hint). */
  url: string | null
  /** The result's real host, recovered from the breadcrumb when the link is wrapped. */
  domain: string | null
  title: string | null
  description: string | null
  /** Google's redirect link, when the result was wrapped. */
  url_wrapped?: string
  /** Approximate page URL rebuilt from the breadcrumb of a wrapped result. */
  url_hint?: string
}

export type KeywordSerpSnapshotResult =
  | { success: true; keyword: string; results: SerpOrganicRow[]; notes?: string[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface SerpItem {
  type: string
  rank_absolute?: number
  url?: string
  domain?: string
  breadcrumb?: string | null
  website_name?: string | null
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
    const { items: rows, cost } = await dataforseoRequest<SerpAdvancedResult>({
      path: 'serp/google/organic/live/advanced',
      task: {
        keyword: input.keyword,
        location_name: input.location_name,
        language_code: input.language_code,
        depth: input.depth,
      },
    })

    const result = rows[0]
    if (!result) {
      return errorResult(ErrorCode.NOT_FOUND, `DataForSEO returned no SERP data for "${input.keyword}".`)
    }

    const organic = (result.items ?? [])
      .filter((item) => item.type === 'organic' && item.url)
      .slice(0, input.depth)
      .map((item): SerpOrganicRow => {
        const u = resultUrl(item)
        return {
          position: item.rank_absolute ?? 0,
          url: u.url,
          domain: resultHost(item),
          title: item.title ?? null,
          description: item.description ?? null,
          ...(u.url_wrapped ? { url_wrapped: u.url_wrapped } : {}),
          ...(u.url_hint ? { url_hint: u.url_hint } : {}),
        }
      })

    const wrapped = organic.filter((r) => r.url_wrapped).length
    const unknown = organic.filter((r) => !r.domain).length
    return {
      success: true,
      keyword: result.keyword,
      results: organic,
      ...(wrapped ? { notes: [`${wrapped} of ${organic.length} results were served through google.com/goto redirects; their domain comes from the breadcrumb and url is null (url_hint is approximate).${unknown ? ` ${unknown} could not be attributed to any host.` : ''}`] } : {}),
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

export const keywordSerpSnapshotTool = {
  name: 'keyword_serp_snapshot',
  description:
    'Use when the user wants to see who currently ranks for a keyword (content-gap analysis, competitive research). ' +
    'Backed by the DataForSEO live Google organic SERP endpoint — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Returns ranked organic results (position, url, domain, title, description), plus cost_usd (billed per call). ' +
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
