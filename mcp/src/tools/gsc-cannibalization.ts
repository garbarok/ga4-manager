import { z } from 'zod'
import { cli } from '../tool-spec.js'

// ============================================================================
// Input Schema
// ============================================================================

export const gscCannibalizationInputSchema = z.object({
  config: z
    .string()
    .min(1, 'config is required')
    .describe('Path to the YAML config file with search_console.site_url set'),
  min_impressions: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(10)
    .describe(
      'Per-page impression threshold for the cannibalisation predicate (default: 10, matching CONTEXT.md)',
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(485)
    .optional()
    .default(28)
    .describe('Lookback window in days (default: 28, max: 485 — GSC retains ~16 months)'),
  with_coverage_state: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, inspect each unique candidate page via URL Inspection and emit a severity tier (actionable | consolidating) per result. Costs one inspection request per unique page; off by default because URL Inspection has a 2000/day budget.',
    ),
  only_actionable: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'When true, drop consolidating findings from the result set. Implies with_coverage_state. Useful for cron wrappers that want "silent on all-green" semantics when every finding is an in-flight migration.',
    ),
})

export type GscCannibalizationInput = z.infer<typeof gscCannibalizationInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface CannibalizationPage {
  page: string
  impressions: number
  /** Populated only when with_coverage_state is true. */
  coverage_state?: string
}

export interface CannibalizationResultRow {
  query: string
  pages: CannibalizationPage[]
  total_impressions: number
  /**
   * The page with the highest impressions on this query — a heuristic,
   * NOT Google's chosen canonical. For migrating sites GSC may still
   * attribute impressions to the legacy URL inside its 28-day window, so
   * the impression leader can be the page you intend to redirect AWAY
   * from. Use with_coverage_state to surface the underlying coverage_state
   * and let the severity tier guide you.
   */
  canonical_candidate: string
  /** Populated only when with_coverage_state is true. */
  severity?: 'actionable' | 'consolidating'
}

export interface CannibalizationOutput {
  command: 'gsc_cannibalization'
  site: string
  generated_at: string
  results: CannibalizationResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildCannibalizationArgs(input: GscCannibalizationInput): string[] {
  const args = [
    'cannibalization',
    '--config',
    input.config,
    '--format',
    'json',
    '--min-impressions',
    String(input.min_impressions),
    '--days',
    String(input.days),
  ]
  if (input.with_coverage_state) {
    args.push('--with-coverage-state')
  }
  if (input.only_actionable) {
    args.push('--only-actionable')
  }
  return args
}

// parseCannibalizationOutput parses the CLI's JSON envelope. The framework
// convention (see docs/BACKLOG.md "Implementation notes") is that --format
// json writes exactly one JSON object to stdout; we parse it directly and
// validate the required fields.
export function parseCannibalizationOutput(stdout: string): CannibalizationOutput {
  const parsed = JSON.parse(stdout) as Partial<CannibalizationOutput>
  if (parsed.command !== 'gsc_cannibalization') {
    throw new Error(
      `Unexpected command in CLI output: ${String(parsed.command)} (want gsc_cannibalization)`,
    )
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as CannibalizationOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscCannibalizationTool = {
  name: 'gsc_cannibalization',
  description:
    'Detect Google Search Console queries where two or more pages on the same site each receive at least the configured impression threshold, splitting authority. Returns queries ranked by total impressions across cannibalising pages and the canonical-page candidate. The canonical_candidate is a heuristic — the page with the highest current impressions on the query, NOT Google\'s chosen canonical — so for migrating sites it may point at a legacy URL still inside the GSC 28-day attribution window. Pass with_coverage_state to additionally inspect each unique candidate page via URL Inspection and surface a severity tier (actionable | consolidating) that distinguishes in-flight consolidations from real cannibalisation. Stateless: one Search Analytics call plus optional URL Inspection calls per unique candidate page.',
  inputSchema: {
    type: 'object',
    required: ['config'],
    properties: {
      config: {
        type: 'string',
        description: 'Path to the YAML config file with search_console.site_url set.',
      },
      min_impressions: {
        type: 'number',
        description:
          'Per-page impression threshold for the cannibalisation predicate. Default: 10.',
        default: 10,
        minimum: 1,
      },
      days: {
        type: 'number',
        description:
          'Lookback window in days. Default: 28. Maximum: 485 (GSC retains roughly 16 months of search-analytics data).',
        default: 28,
        minimum: 1,
        maximum: 485,
      },
      with_coverage_state: {
        type: 'boolean',
        description:
          'When true, inspect each unique candidate page via URL Inspection and emit a severity tier per result (actionable | consolidating). Costs one inspection request per unique page; off by default because URL Inspection has a 2000/day budget.',
        default: false,
      },
      only_actionable: {
        type: 'boolean',
        description:
          'When true, drop consolidating findings from the result set. Implies with_coverage_state.',
        default: false,
      },
    },
  },
  annotations: {
    title: 'Detect keyword cannibalization',
    readOnlyHint: true,
  },
} as const

export const gscCannibalizationSpec = cli({
  tool: gscCannibalizationTool,
  schema: gscCannibalizationInputSchema,
  command: 'gsc',
  buildArgs: buildCannibalizationArgs,
  parse: (out) => parseCannibalizationOutput(out),
})
