import { z } from 'zod'

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
})

export type GscCannibalizationInput = z.infer<typeof gscCannibalizationInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface CannibalizationPage {
  page: string
  impressions: number
}

export interface CannibalizationResultRow {
  query: string
  pages: CannibalizationPage[]
  total_impressions: number
  canonical_candidate: string
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
  const args: string[] = ['cannibalization', '--config', input.config, '--format', 'json']
  if (input.min_impressions !== undefined && input.min_impressions !== 10) {
    args.push('--min-impressions', input.min_impressions.toString())
  }
  return args
}

// parseCannibalizationOutput extracts the JSON envelope from CLI stdout. The
// CLI emits a single JSON object under --format json; if the envelope is
// missing or malformed, an Error is thrown so the dispatch layer can wrap it
// as a tool failure.
export function parseCannibalizationOutput(stdout: string): CannibalizationOutput {
  const match = stdout.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('No JSON envelope found in CLI output')
  }
  const parsed = JSON.parse(match[0]) as Partial<CannibalizationOutput>
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
    'Detect Google Search Console queries where two or more pages on the same site each receive at least the configured impression threshold, splitting authority. Returns queries ranked by total impressions across cannibalising pages and the canonical-page candidate (highest impressions). Stateless: one Search Analytics API call per run.',
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
    },
  },
} as const
