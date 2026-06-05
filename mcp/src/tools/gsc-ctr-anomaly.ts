import { z } from 'zod'

// ============================================================================
// Input Schema
// ============================================================================

export const gscCTRAnomalyInputSchema = z.object({
  config: z
    .string()
    .min(1, 'config is required')
    .describe('Path to the YAML config file with search_console.site_url set'),
  days: z
    .number()
    .int()
    .min(1)
    .max(240)
    .optional()
    .default(28)
    .describe(
      'Length of each comparison window in days (current vs prior). Default: 28. Max: 240 (allows two back-to-back windows within GSC retention).',
    ),
  min_clicks_prior: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(5)
    .describe(
      'Drop pairs whose prior-window click count is below this floor. Default: 5 — kills long-tail noise that would generate false CTR-anomalies with sample size = 1.',
    ),
  min_clicks_lost: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe(
      'Drop pairs that lost fewer than this many clicks between windows. Default: 0.',
    ),
})

export type GscCTRAnomalyInput = z.infer<typeof gscCTRAnomalyInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface CTRAnomalyResultRow {
  query: string
  page: string
  position_current: number
  position_prior: number
  position_delta: number
  ctr_current: number
  ctr_prior: number
  ctr_delta: number
  clicks_current: number
  clicks_prior: number
  /** Headline number: absolute clicks lost vs prior window. Sort key. */
  clicks_lost: number
  impressions_current: number
  impressions_prior: number
}

export interface CTRAnomalyOutput {
  command: 'gsc_ctr_anomaly'
  site: string
  generated_at: string
  results: CTRAnomalyResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildCTRAnomalyArgs(input: GscCTRAnomalyInput): string[] {
  return [
    'ctr-anomaly',
    '--config',
    input.config,
    '--format',
    'json',
    '--days',
    String(input.days),
    '--min-clicks-prior',
    String(input.min_clicks_prior),
    '--min-clicks-lost',
    String(input.min_clicks_lost),
  ]
}

export function parseCTRAnomalyOutput(stdout: string): CTRAnomalyOutput {
  const parsed = JSON.parse(stdout) as Partial<CTRAnomalyOutput>
  if (parsed.command !== 'gsc_ctr_anomaly') {
    throw new Error(
      `Unexpected command in CLI output: ${String(parsed.command)} (want gsc_ctr_anomaly)`,
    )
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as CTRAnomalyOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscCTRAnomalyTool = {
  name: 'gsc_ctr_anomaly',
  description:
    "Compare two consecutive windows of Google Search Console data and surface (query, page) pairs whose ranking position barely moved but whose click-through rate collapsed. These are snippet-driven regressions — the page is still ranking, but its title/meta has stopped converting against the SERP. Each result carries position_current/prior/delta, ctr_current/prior/delta, clicks_current/prior/lost, and impressions_current/prior — everything an LLM consumer needs to prioritise and rewrite the snippet. Results sorted by clicks_lost descending. Stateless: two Search Analytics API calls per run.",
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
        description: 'Length of each comparison window in days. Default: 28. Max: 240.',
        default: 28,
        minimum: 1,
        maximum: 240,
      },
      min_clicks_prior: {
        type: 'number',
        description:
          'Drop pairs whose prior-window clicks are below this floor (kills long-tail noise). Default: 5.',
        default: 5,
        minimum: 0,
      },
      min_clicks_lost: {
        type: 'number',
        description: 'Drop pairs that lost fewer than this many clicks. Default: 0.',
        default: 0,
        minimum: 0,
      },
    },
  },
} as const
