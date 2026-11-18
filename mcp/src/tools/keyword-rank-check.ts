import { z } from 'zod'
import { native } from '../tool-spec.js'
import { valueSerpSearch, type ValueSerpAiOverviewSource } from '../utils/valueserp-client.js'
import { resultHost, resultUrl, hostMatchesSite } from '../utils/serp-host.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const keywordRankCheckInputSchema = z.object({
  keyword: z.string().min(1).describe('The search query to check rank for'),
  domain: z.string().min(1).describe('Domain to find in the results, e.g. "example.com" (matched against each result\'s hostname, www.-insensitive)'),
  location: z.string().optional().default('United States').describe('ValueSERP location string (default: "United States")'),
  google_domain: z.string().optional().default('google.com').describe('Google TLD to search, e.g. "google.com", "google.es" (default: "google.com")'),
  num: z.number().int().min(1).max(100).optional().default(100).describe('How many organic results to scan (default 100, ValueSERP max per page)'),
  check_ai_overview: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'When domain is absent from organic results and Google shows an AI Overview for this query, fetch its cited sources too and check whether domain is cited there instead ' +
        '(a page can be cited by an AI Overview without appearing in classic organic results). Costs one extra ValueSERP credit, only when this fallback actually triggers.',
    ),
})

export type KeywordRankCheckInput = z.infer<typeof keywordRankCheckInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface AiOverviewCheck {
  /** Google shows an AI Overview for this query (detected for free, no extra credit). */
  present: boolean
  /** Whether its cited-sources list was actually fetched (costs an extra credit; only happens on the organic-miss fallback). */
  checked: boolean
  /** Only meaningful when checked is true. */
  cited: boolean
  matched_url: string | null
  sources: ValueSerpAiOverviewSource[]
}

export interface KeywordRankCheckResult {
  keyword: string
  domain: string
  position: number | null
  matched_url: string | null
  ai_overview: AiOverviewCheck
  /** wrapped: Google served the link through google.com/goto; url is then the breadcrumb hint. */
  top_results: { position: number; url: string; domain: string | null; title: string; wrapped: boolean }[]
  /** True when matched_url was rebuilt from a breadcrumb (approximate). */
  matched_url_is_hint: boolean
  checked_at: string
}

export type KeywordRankCheckOutput = { success: true; result: KeywordRankCheckResult } | ToolFailureResult

// ============================================================================
// Helpers
// ============================================================================

/** The organic result's real host: its link, or the domain/displayed_link when Google wrapped the link. */
function organicHost(r: { link: string; domain?: string; displayed_link?: string }): string | null {
  return resultHost({ url: r.link, domain: r.domain, displayed_link: r.displayed_link })
}

// ============================================================================
// Handler
// ============================================================================

export async function runKeywordRankCheck(input: KeywordRankCheckInput): Promise<KeywordRankCheckOutput> {
  try {
    const { organic, aiOverviewPresent } = await valueSerpSearch({
      q: input.keyword,
      location: input.location,
      google_domain: input.google_domain,
      num: input.num,
    })

    const match = organic.find((r) => hostMatchesSite(organicHost(r), input.domain))

    let aiOverview: AiOverviewCheck = {
      present: aiOverviewPresent,
      checked: false,
      cited: false,
      matched_url: null,
      sources: [],
    }

    // Only pay the extra credit when it can change the answer: the domain missed
    // organic, and Google is showing an AI Overview it could be cited in instead
    // — a page can be exactly what Google surfaces for a query while being
    // invisible to organic-only scraping.
    if (!match && aiOverviewPresent && input.check_ai_overview) {
      const { aiOverviewSources } = await valueSerpSearch({
        q: input.keyword,
        location: input.location,
        google_domain: input.google_domain,
        num: input.num,
        include_ai_overview: true,
      })
      const aiMatch = aiOverviewSources.find((s) => hostMatchesSite(resultHost({ url: s.url, domain: s.domain }), input.domain))
      aiOverview = {
        present: true,
        checked: true,
        cited: Boolean(aiMatch),
        matched_url: aiMatch?.url ?? null,
        sources: aiOverviewSources,
      }
    }

    return {
      success: true,
      result: {
        keyword: input.keyword,
        domain: input.domain,
        position: match?.position ?? null,
        matched_url: match ? (resultUrl({ url: match.link, displayed_link: match.displayed_link }).url ?? resultUrl({ url: match.link, displayed_link: match.displayed_link }).url_hint) : null,
        matched_url_is_hint: match ? resultUrl({ url: match.link }).url === null : false,
        ai_overview: aiOverview,
        top_results: organic.slice(0, 10).map((r) => {
          const u = resultUrl({ url: r.link, displayed_link: r.displayed_link })
          return { position: r.position, url: u.url ?? u.url_hint ?? r.link, domain: organicHost(r), title: r.title, wrapped: u.url_wrapped !== null }
        }),
        checked_at: new Date().toISOString(),
      },
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const keywordRankCheckTool = {
  name: 'keyword_rank_check',
  description:
    'Use when the user wants today\'s actual Google rank for a domain on a keyword — distinct from GSC\'s impression-weighted historical average position already in site_growth_brief / gsc_opportunities. ' +
    'Backed by a live ValueSERP query — needs VALUESERP_API_KEY. ' +
    'Scans up to `num` organic results for the first URL whose hostname matches `domain` (www.-insensitive, subdomains count). ' +
    'When domain misses organic and Google shows an AI Overview for this query, also checks whether it\'s cited there instead (ai_overview in the result) — ' +
    'a page can be exactly what Google is showing searchers while being absent from classic organic results, which would otherwise look like "not ranking". ' +
    'Returns position (null if not found within the scanned depth), the matched URL, the ai_overview check, and the top 10 organic results for context.',
  inputSchema: {
    type: 'object',
    required: ['keyword', 'domain'],
    properties: {
      keyword: { type: 'string', description: 'The search query to check rank for' },
      domain: { type: 'string', description: 'Domain to find in the results, e.g. "example.com"' },
      location: { type: 'string', description: 'ValueSERP location string (default: "United States")', default: 'United States' },
      google_domain: {
        type: 'string',
        description: 'Google TLD to search, e.g. "google.com", "google.es" (default: "google.com")',
        default: 'google.com',
      },
      num: {
        type: 'number',
        description: 'How many organic results to scan (default 100, ValueSERP max per page)',
        default: 100,
      },
      check_ai_overview: {
        type: 'boolean',
        description:
          'When domain is absent from organic and Google shows an AI Overview, fetch its cited sources too (costs one extra ValueSERP credit, only when this fallback triggers) (default: true)',
        default: true,
      },
    },
  },
  annotations: { title: 'Live keyword rank check', readOnlyHint: true, openWorldHint: true },
}

export const keywordRankCheckSpec = native({
  tool: keywordRankCheckTool,
  schema: keywordRankCheckInputSchema,
  run: async (input) => {
    const output = await runKeywordRankCheck(input)
    return { output, isError: !output.success }
  },
})
