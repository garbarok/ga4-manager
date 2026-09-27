import { z } from 'zod'
import { cli } from '../tool-spec.js'

// ============================================================================
// Input Schema
// ============================================================================

export const gscUrlHygieneInputSchema = z.object({
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
    .default(90)
    .describe('Lookback window in days (default: 90 — hygiene issues are low-volume)'),
})

export type GscUrlHygieneInput = z.infer<typeof gscUrlHygieneInputSchema>

// ============================================================================
// Output Types — mirror the CLI JSON envelope exactly
// ============================================================================

export type HygieneIssue = 'malformed_path' | 'fragment' | 'asset_route' | 'query_duplicate' | 'utility_page'

export interface UrlHygieneResultRow {
  url: string
  issue: HygieneIssue
  severity: 'warning' | 'info'
  impressions: number
  clicks: number
  /** One-line remediation specific to the issue type. */
  fix: string
}

export interface UrlHygieneOutput {
  command: 'gsc_url_hygiene'
  site: string
  generated_at: string
  results: UrlHygieneResultRow[]
  quota_used: number
}

// ============================================================================
// CLI Wiring
// ============================================================================

export function buildUrlHygieneArgs(input: GscUrlHygieneInput): string[] {
  return ['url-hygiene', '--config', input.config, '--format', 'json', '--days', String(input.days)]
}

export function parseUrlHygieneOutput(stdout: string): UrlHygieneOutput {
  const parsed = JSON.parse(stdout) as Partial<UrlHygieneOutput>
  if (parsed.command !== 'gsc_url_hygiene') {
    throw new Error(`Unexpected command in CLI output: ${String(parsed.command)} (want gsc_url_hygiene)`)
  }
  if (typeof parsed.site !== 'string' || typeof parsed.generated_at !== 'string') {
    throw new Error('CLI output missing site or generated_at')
  }
  if (!Array.isArray(parsed.results) || typeof parsed.quota_used !== 'number') {
    throw new Error('CLI output missing results or quota_used')
  }
  return parsed as UrlHygieneOutput
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const gscUrlHygieneTool = {
  name: 'gsc_url_hygiene',
  description:
    'Use when auditing which URLs Google shows in search that should not be standalone results. ' +
    'Classifies every URL with search impressions in the window into at most one issue: ' +
    'malformed_path (path repeats the site host or has "//" — a broken relative link on the site), ' +
    'fragment ("#anchor" URL listed as a result), asset_route (opengraph-image, twitter-image, icon, apple-icon, /_next/), ' +
    'query_duplicate (query-string variant of an indexed clean URL), utility_page (privacy/terms/cookies/disclaimer/legal/contact, severity info). ' +
    'Each result has url, issue, severity, impressions, clicks and a one-line fix, sorted warnings first then by impressions. ' +
    'Stateless: one Search Analytics call. Read-only.',
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
        description: 'Lookback window in days. Default: 90. Max: 485.',
        default: 90,
        minimum: 1,
        maximum: 485,
      },
    },
  },
  annotations: {
    title: 'Find index-polluting URLs',
    readOnlyHint: true,
  },
} as const

export const gscUrlHygieneSpec = cli({
  tool: gscUrlHygieneTool,
  schema: gscUrlHygieneInputSchema,
  command: 'gsc',
  buildArgs: buildUrlHygieneArgs,
  parse: (out) => parseUrlHygieneOutput(out),
})
