import { z } from 'zod'

// ============================================================================
// Input Schema
// ============================================================================

export const gscHealthInputSchema = z.object({
  config: z
    .string()
    .min(1, 'config is required')
    .describe(
      'Path to the YAML config file with search_console.url_inspection.priority_urls set',
    ),
  state_dir: z
    .string()
    .optional()
    .describe(
      'Override the state directory. Default: .ga4-state/ relative to the working directory.',
    ),
  dry_run: z
    .boolean()
    .optional()
    .default(false)
    .describe('Inspect and diff but do not write a new snapshot.'),
})

export type GscHealthInput = z.infer<typeof gscHealthInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface HealthFieldChange {
  field: string
  before: string
  after: string
}

export interface HealthURLState {
  coverage_state: string
  google_canonical: string
  user_canonical: string
  robots_blocked: boolean
  indexing_allowed: boolean
  mobile_usable: boolean
  rich_results_status: string
}

export interface HealthResultRow {
  url: string
  change: 'regression' | 'recovery' | 'baseline'
  changes?: HealthFieldChange[]
  current_state: HealthURLState
}

export interface HealthOutput {
  command: 'gsc_health'
  site: string
  generated_at: string
  results: HealthResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildHealthArgs(input: GscHealthInput): string[] {
  const args = ['health', '--config', input.config, '--format', 'json']
  if (input.state_dir) {
    args.push('--state-dir', input.state_dir)
  }
  if (input.dry_run) {
    args.push('--dry-run')
  }
  return args
}

export function parseHealthOutput(stdout: string): HealthOutput {
  const parsed = JSON.parse(stdout) as Partial<HealthOutput>
  if (parsed.command !== 'gsc_health') {
    throw new Error(
      `Unexpected command in CLI output: ${String(parsed.command)} (want gsc_health)`,
    )
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as HealthOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscHealthTool = {
  name: 'gsc_health',
  description:
    "Weekly index-health report. Inspects every URL declared under search_console.url_inspection.priority_urls in the config file, diffs each URL's coverage state against the prior snapshot stored at .ga4-state/health.<site>.json (per ADR-0005), and surfaces regressions, recoveries, and first-time baselines. Designed to run on a weekly cron so noindex bugs, canonical mismatches, mobile-usability regressions, and rich-result failures are caught within days. Silent on all-green: zero regressions → empty results array; ≥1 regression → results populated and the underlying CLI exits 2. Each result carries the field-level diff plus the full current state of the URL so an LLM consumer can triage without re-inspecting. Quota cost: one URL Inspection request per priority URL per run.",
  inputSchema: {
    type: 'object',
    required: ['config'],
    properties: {
      config: {
        type: 'string',
        description:
          'Path to the YAML config file with search_console.url_inspection.priority_urls set.',
      },
      state_dir: {
        type: 'string',
        description:
          'Override the state directory. Default: .ga4-state/ relative to the working directory.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Inspect and diff but do not write a new snapshot.',
        default: false,
      },
    },
  },
  annotations: { title: 'Search Console health check', readOnlyHint: true },
} as const
