import { z } from 'zod'
import { cli } from '../tool-spec.js'

// ============================================================================
// Input Schema
// ============================================================================

export const gscOpportunitiesInputSchema = z.object({
  config: z
    .string()
    .min(1, 'config is required')
    .describe('Path to the YAML config file with search_console.site_url set'),
  days: z
    .number()
    .int()
    .min(1)
    .max(485)
    .optional()
    .default(28)
    .describe('Lookback window in days (default: 28, max: 485 — GSC retains ~16 months)'),
  min_impressions: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(20)
    .describe(
      'Minimum impressions for a query to be considered (drops long-tail noise from the bucket median calculation). Default: 20.',
    ),
  granularity: z
    .enum(['query', 'page'])
    .optional()
    .default('query')
    .describe(
      'query (default): one result per query × page. page: one result per page — catches pages whose impressions sit in GSC\'s anonymized long tail; adds top_queries and anonymized_share; costs 2 quota.',
    ),
  min_potential_clicks: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(1)
    .describe(
      'Filter out opportunities below this projected monthly click gain. Default: 1 — suppresses 0-click rounding-error findings on small sites; set to 0 to surface everything.',
    ),
})

export type GscOpportunitiesInput = z.infer<typeof gscOpportunitiesInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface OpportunityResultRow {
  query: string
  page: string
  position: number
  clicks: number
  impressions: number
  ctr: number
  bucket: number
  category_median_ctr: number
  ctr_gap: number
  /**
   * The headline number for prioritising work: the extra monthly clicks
   * this page would receive if it converted at the median CTR for its
   * position bucket. Results are sorted by this descending.
   */
  potential_clicks: number
  /** Page granularity only: up to 5 disclosed queries by impressions. */
  top_queries?: { query: string; impressions: number; clicks: number; position: number }[]
  /**
   * Page granularity only: share of the page's impressions not attributed to
   * any disclosed query (0–1). High → the rewrite targets an invisible long tail.
   */
  anonymized_share?: number
}

export interface OpportunitiesOutput {
  command: 'gsc_opportunities'
  site: string
  generated_at: string
  results: OpportunityResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildOpportunitiesArgs(input: GscOpportunitiesInput): string[] {
  return [
    'opportunities',
    '--config',
    input.config,
    '--format',
    'json',
    '--days',
    String(input.days),
    '--min-impressions',
    String(input.min_impressions),
    '--min-potential-clicks',
    String(input.min_potential_clicks),
    // Query granularity is the CLI default; only page mode needs the flag.
    ...(input.granularity === 'page' ? ['--granularity', 'page'] : []),
  ]
}

export function parseOpportunitiesOutput(stdout: string): OpportunitiesOutput {
  const parsed = JSON.parse(stdout) as Partial<OpportunitiesOutput>
  if (parsed.command !== 'gsc_opportunities') {
    throw new Error(
      `Unexpected command in CLI output: ${String(parsed.command)} (want gsc_opportunities)`,
    )
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as OpportunitiesOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscOpportunitiesTool = {
  name: 'gsc_opportunities',
  description:
    'Detect under-converting queries on page 1–2 of Google Search Console. For each query × page where the page already ranks at position 5–20 but the CTR is below the median for its position bucket, the result carries everything an LLM consumer needs to act: query, page, current position, clicks, impressions, ctr, bucket, category_median_ctr, ctr_gap, and potential_clicks (the extra monthly clicks the page would gain at the bucket median CTR). Results are sorted by potential_clicks descending so the biggest revenue wins come first. Stateless: one Search Analytics API call per run. The current page title and meta description are NOT in GSC data — fetch them from the site itself when feeding an LLM for rewriting. ' +
    'Use granularity="page" to rank whole pages instead: it finds high-impression pages whose traffic is spread over anonymized long-tail queries (no single query stands out), and adds top_queries plus anonymized_share per page. Page mode costs 2 Search Analytics calls. ' +
    'potential_clicks is an upper-bound estimate when median_source is "baseline" (industry curve, not vertical-specific).',
  inputSchema: {
    type: 'object',
    required: ['config'],
    properties: {
      config: {
        type: 'string',
        description: 'Path to the YAML config file with search_console.site_url set.',
      },
      days: {
        type: 'number',
        description: 'Lookback window in days. Default: 28. Max: 485.',
        default: 28,
        minimum: 1,
        maximum: 485,
      },
      min_impressions: {
        type: 'number',
        description:
          'Minimum impressions for a query to be considered. Drops long-tail noise from the bucket median. Default: 20.',
        default: 20,
        minimum: 1,
      },
      granularity: {
        type: 'string',
        enum: ['query', 'page'],
        default: 'query',
        description:
          'query (default): results per query × page. page: results per page, with top_queries and anonymized_share — use it to find big pages whose impressions are spread across anonymized long-tail queries.',
      },
      min_potential_clicks: {
        type: 'number',
        description:
          'Drop opportunities below this projected monthly click gain. Default: 1 (suppresses 0-click rounding-error findings on small sites).',
        default: 1,
        minimum: 0,
      },
    },
  },
  annotations: {
    title: 'Find SEO opportunities',
    readOnlyHint: true,
  },
} as const

export const gscOpportunitiesSpec = cli({
  tool: gscOpportunitiesTool,
  schema: gscOpportunitiesInputSchema,
  command: 'gsc',
  buildArgs: buildOpportunitiesArgs,
  parse: (out) => parseOpportunitiesOutput(out),
})
