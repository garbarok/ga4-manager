import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain, sumCosts } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const backlinksOverviewInputSchema = z.object({
  domains: z.array(z.string().min(1)).min(1).max(5).describe('1–5 domains to compare, e.g. ["example.com", "rival.com"]'),
})

export type BacklinksOverviewInput = z.infer<typeof backlinksOverviewInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface BacklinksOverviewRow {
  domain: string
  /** DataForSEO domain rank, 0–100 scale. */
  rank?: number | null
  backlinks?: number | null
  referring_domains?: number | null
  referring_main_domains?: number | null
  /** Share of backlinks not marked nofollow (0–1). */
  dofollow_ratio?: number | null
  error?: string
}

export type BacklinksOverviewResult =
  | { success: true; results: BacklinksOverviewRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface BacklinksSummaryResult {
  rank?: number | null
  backlinks?: number | null
  referring_domains?: number | null
  referring_main_domains?: number | null
  referring_links_attributes?: Record<string, number> | null
}

// ============================================================================
// Handler
// ============================================================================

export function toOverviewRow(domain: string, r: BacklinksSummaryResult | undefined): BacklinksOverviewRow {
  const backlinks = r?.backlinks ?? null
  const nofollow = r?.referring_links_attributes?.nofollow ?? 0
  return {
    domain,
    rank: r?.rank ?? null,
    backlinks,
    referring_domains: r?.referring_domains ?? null,
    referring_main_domains: r?.referring_main_domains ?? null,
    dofollow_ratio: backlinks ? Math.round((1 - nofollow / backlinks) * 1000) / 1000 : null,
  }
}

export async function runBacklinksOverview(input: BacklinksOverviewInput): Promise<BacklinksOverviewResult> {
  const domains = input.domains.map(normalizeDomain)
  const settled = await Promise.allSettled(
    domains.map((target) =>
      dataforseoRequest<BacklinksSummaryResult>({
        path: 'backlinks/summary/live',
        task: { target, include_subdomains: true, rank_scale: 'one_hundred', internal_list_limit: 1 },
      }),
    ),
  )

  // If nothing succeeded, surface the first error as-is (e.g. no Backlinks subscription).
  if (settled.every((s) => s.status === 'rejected')) {
    const err = (settled[0] as PromiseRejectedResult).reason
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }

  const results = settled.map((s, i): BacklinksOverviewRow => {
    if (s.status === 'fulfilled') return toOverviewRow(domains[i], s.value.items[0])
    return { domain: domains[i], error: s.reason instanceof Error ? s.reason.message : String(s.reason) }
  })

  return {
    success: true,
    results,
    cost_usd: sumCosts(settled.map((s) => (s.status === 'fulfilled' ? s.value.cost : null))),
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const backlinksOverviewTool = {
  name: 'backlinks_overview',
  description:
    'Use when the user wants to compare link authority between their site and competitors ("why do thinner sites outrank us?"). ' +
    'Backed by DataForSEO Backlinks summary — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD and the Backlinks subscription. ' +
    'Billed per domain (~$0.02 each). ' +
    'Returns per domain: rank (0–100), backlinks, referring_domains, referring_main_domains, dofollow_ratio; plus cost_usd. ' +
    'Follow up with link_gap to find the referring domains competitors have and you do not.',
  inputSchema: {
    type: 'object',
    required: ['domains'],
    properties: {
      domains: { type: 'array', items: { type: 'string' }, description: '1–5 domains to compare' },
    },
  },
  annotations: { title: 'Backlink overview by domain', readOnlyHint: true, openWorldHint: true },
}

export const backlinksOverviewSpec = native({
  tool: backlinksOverviewTool,
  schema: backlinksOverviewInputSchema,
  run: async (input) => {
    const output = await runBacklinksOverview(input)
    return { output, isError: !output.success }
  },
})
