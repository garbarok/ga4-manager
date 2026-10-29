import { z } from 'zod'
import { cli } from '../tool-spec.js'

// ============================================================================
// Input Schema
// ============================================================================

export const gscHreflangInputSchema = z.object({
  config: z
    .string()
    .min(1, 'config is required')
    .describe('Path to the YAML config file with search_console.site_url set (optionally search_console.hreflang_pairs)'),
  days: z.number().int().min(1).max(485).optional().default(28).describe('Lookback window in days (default: 28)'),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Pages to fetch for pair discovery when the config declares no hreflang_pairs (default: 50)'),
  min_impressions: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(10)
    .describe('Impressions a wrong-language query needs to be reported (default: 10)'),
})

export type GscHreflangInput = z.infer<typeof gscHreflangInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export type HreflangIssue =
  | 'missing_return_link'
  | 'missing_self_reference'
  | 'wrong_target'
  | 'missing_x_default'
  | 'cross_language_ranking'
  | 'no_hreflang'
  | 'language_check_skipped'

export interface HreflangResultRow {
  /** The translation pair (language → URL) the finding belongs to. */
  pair?: Record<string, string>
  page: string
  issue: HreflangIssue
  severity: 'warning' | 'info'
  detail: string
  /** cross_language_ranking only. */
  query?: string
  expected_page?: string
  impressions?: number
}

export interface HreflangOutput {
  command: 'gsc_hreflang'
  site: string
  generated_at: string
  results: HreflangResultRow[]
  /** HTTP page fetches made (not Google API quota). */
  pages_fetched: number
  /** Search Analytics API calls. */
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildHreflangArgs(input: GscHreflangInput): string[] {
  return [
    'hreflang',
    '--config',
    input.config,
    '--format',
    'json',
    '--days',
    String(input.days),
    '--max-pages',
    String(input.max_pages),
    '--min-impressions',
    String(input.min_impressions),
  ]
}

export function parseHreflangOutput(stdout: string): HreflangOutput {
  const parsed = JSON.parse(stdout) as Partial<HreflangOutput>
  if (parsed.command !== 'gsc_hreflang') {
    throw new Error(`Unexpected command in CLI output: ${String(parsed.command)} (want gsc_hreflang)`)
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (
    !Array.isArray(parsed.results) ||
    typeof parsed.quota_used !== 'number' ||
    typeof parsed.pages_fetched !== 'number'
  ) {
    throw new Error('CLI output missing results, pages_fetched or quota_used')
  }
  return parsed as HreflangOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscHreflangTool = {
  name: 'gsc_hreflang',
  description:
    'Use when a site has translated pages (e.g. an English and a Spanish version) and you need to know whether hreflang is wired correctly, or whether Google shows the wrong-language page. ' +
    'Pairs come from search_console.hreflang_pairs in the config; otherwise they are discovered by fetching the top pages by impressions and reading their <link rel="alternate" hreflang> tags. ' +
    'Reports missing_return_link, missing_self_reference, wrong_target (points elsewhere, off-site, or non-200), missing_x_default (info), ' +
    'and cross_language_ranking: a query in one pair language getting impressions on the other language\'s page, with the query, impressions and the page that should rank. ' +
    'Fetches only the configured site\'s own pages (max 4 at a time). Read-only.',
  inputSchema: {
    type: 'object',
    required: ['config'],
    properties: {
      config: {
        type: 'string',
        description: 'Path to the YAML config file with search_console.site_url set.',
      },
      days: { type: 'number', description: 'Lookback window in days. Default: 28.', default: 28, minimum: 1, maximum: 485 },
      max_pages: {
        type: 'number',
        description: 'Pages fetched for discovery when no hreflang_pairs are configured. Default: 50.',
        default: 50,
        minimum: 1,
        maximum: 500,
      },
      min_impressions: {
        type: 'number',
        description: 'Impressions a wrong-language query needs to be reported. Default: 10.',
        default: 10,
        minimum: 1,
      },
    },
  },
  annotations: {
    title: 'Check hreflang pairs',
    readOnlyHint: true,
    openWorldHint: true,
  },
} as const

export const gscHreflangSpec = cli({
  tool: gscHreflangTool,
  schema: gscHreflangInputSchema,
  command: 'gsc',
  buildArgs: buildHreflangArgs,
  parse: (out) => parseHreflangOutput(out),
})
