import { z } from 'zod'
import { cli } from '../tool-spec.js'

// ============================================================================
// Input Schema
// ============================================================================

export const gscDecayInputSchema = z.object({
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
      'Drop pairs whose prior-window click count is below this floor. Default: 5 — kills long-tail noise.',
    ),
  min_clicks_lost: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Drop pairs that lost fewer than this many clicks between windows. Default: 0.'),
})

export type GscDecayInput = z.infer<typeof gscDecayInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export interface DecayResultRow {
  query: string
  page: string
  position_current: number
  position_prior: number
  /** current - prior; positive means the page slipped (higher position number = worse). */
  position_delta: number
  clicks_current: number
  clicks_prior: number
  /** Relative change as a ratio, e.g. -0.5 for a 50% drop. */
  clicks_delta: number
  /** Headline number: absolute clicks lost vs prior window. Sort key. */
  clicks_lost: number
  impressions_current: number
  impressions_prior: number
}

export interface DecayOutput {
  command: 'gsc_decay'
  site: string
  generated_at: string
  results: DecayResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildDecayArgs(input: GscDecayInput): string[] {
  return [
    'decay',
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

export function parseDecayOutput(stdout: string): DecayOutput {
  const parsed = JSON.parse(stdout) as Partial<DecayOutput>
  if (parsed.command !== 'gsc_decay') {
    throw new Error(
      `Unexpected command in CLI output: ${String(parsed.command)} (want gsc_decay)`,
    )
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as DecayOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscDecayTool = {
  name: 'gsc_decay',
  description:
    "Compare the last N days of Google Search Console data (default 28) with the prior N days and surface (query, page) pairs that slipped in ranking position by at least 1.0 AND lost at least 20% of their clicks (content decay). Decay is strictly position-driven; clicks lost through a CTR collapse at a stable position are reported by gsc_ctr_anomaly instead. Each result carries position_current/prior/delta, clicks_current/prior/delta/lost and impressions_current/prior. Results sorted by clicks_lost descending. Stateless: two Search Analytics API calls per run.",
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
  annotations: { title: 'Detect content decay', readOnlyHint: true },
} as const

export const gscDecaySpec = cli({
  tool: gscDecayTool,
  schema: gscDecayInputSchema,
  command: 'gsc',
  buildArgs: buildDecayArgs,
  parse: (out) => parseDecayOutput(out),
})
