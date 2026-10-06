import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, normalizeDomain, sumCosts } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const linkGapInputSchema = z.object({
  domain: z.string().min(1).describe('Your domain, e.g. "example.com"'),
  competitors: z.array(z.string().min(1)).min(1).max(3).describe('1–3 competitor domains'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Max referring domains per competitor (default 100, max 1000)'),
})

export type LinkGapInput = z.infer<typeof linkGapInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface LinkGapRow {
  referring_domain: string
  /** DataForSEO rank of the referring domain, 0–100 scale. */
  rank: number | null
  /** Competitors this domain links to (and you do not). */
  links_to: string[]
}

export type LinkGapResult =
  | { success: true; domain: string; competitors: string[]; results: LinkGapRow[]; cost_usd: number | null }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface IntersectionTarget {
  target?: string | null
  rank?: number | null
}

interface DomainIntersectionResult {
  items?: { domain_intersection?: Record<string, IntersectionTarget | null> | null }[] | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runLinkGap(input: LinkGapInput): Promise<LinkGapResult> {
  const domain = normalizeDomain(input.domain)
  const competitors = [...new Set(input.competitors.map(normalizeDomain))]
  if (competitors.includes(domain)) {
    return errorResult(ErrorCode.INVALID_INPUT, `${domain} is listed as both domain and competitor.`)
  }

  try {
    // domain_intersection returns domains linking to ALL targets, so query each
    // competitor separately to get "links to at least one competitor".
    const responses = await Promise.all(
      competitors.map((competitor) =>
        dataforseoRequest<DomainIntersectionResult>({
          path: 'backlinks/domain_intersection/live',
          task: {
            targets: { '1': competitor },
            exclude_targets: [domain],
            include_subdomains: true,
            rank_scale: 'one_hundred',
            order_by: ['1.rank,desc'],
            limit: input.limit,
          },
        }),
      ),
    )

    const merged = new Map<string, LinkGapRow>()
    responses.forEach(({ items }, i) => {
      for (const item of items[0]?.items ?? []) {
        const entry = item.domain_intersection?.['1']
        if (!entry?.target) continue
        const referring = normalizeDomain(entry.target)
        if (referring === domain) continue
        const row = merged.get(referring) ?? { referring_domain: referring, rank: entry.rank ?? null, links_to: [] }
        if (!row.links_to.includes(competitors[i])) row.links_to.push(competitors[i])
        row.rank = Math.max(row.rank ?? 0, entry.rank ?? 0)
        merged.set(referring, row)
      }
    })

    const results = [...merged.values()].sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1) || b.links_to.length - a.links_to.length)

    return { success: true, domain, competitors, results, cost_usd: sumCosts(responses.map((r) => r.cost)) }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const linkGapTool = {
  name: 'link_gap',
  description:
    'Use when the user wants link-building/outreach targets: domains that link to competitors but not to their site. ' +
    'Backed by DataForSEO Backlinks domain_intersection (one request per competitor) — needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD and the Backlinks subscription. ' +
    'Billed per competitor (~$0.02 + per-row cost each). ' +
    'Returns referring_domain, rank (0–100) and links_to (which competitors it links to), highest rank first; plus cost_usd. ' +
    'Run backlinks_overview first to see how wide the authority gap is.',
  inputSchema: {
    type: 'object',
    required: ['domain', 'competitors'],
    properties: {
      domain: { type: 'string', description: 'Your domain, e.g. "example.com"' },
      competitors: { type: 'array', items: { type: 'string' }, description: '1–3 competitor domains' },
      limit: { type: 'number', description: 'Max referring domains per competitor (default 100, max 1000)', default: 100 },
    },
  },
  annotations: { title: 'Link gap vs competitors', readOnlyHint: true, openWorldHint: true },
}

export const linkGapSpec = native({
  tool: linkGapTool,
  schema: linkGapInputSchema,
  run: async (input) => {
    const output = await runLinkGap(input)
    return { output, isError: !output.success }
  },
})
