import { z } from 'zod'
import { extractSignals, type HtmlSignals } from './html-signals.js'
import { runIssueRules, summarizeIssues, type SeoIssue, type IssueSummary } from './issue-rules.js'
import { fetchWithTrace, type RedirectHop } from '../utils/redirect-trace.js'
import { ToolError } from '../utils/errors.js'

// Re-export granular helpers so existing imports continue to work
export {
  extractTitle,
  extractMetaContent,
  extractCanonical,
  countHreflang,
  extractSchemaTypes,
  extractSignals,
  type HtmlSignals,
} from './html-signals.js'
export {
  runIssueRules as detectIssues,
  summarizeIssues,
  type SeoIssue,
  type IssueSummary,
} from './issue-rules.js'
export type { RedirectHop } from '../utils/redirect-trace.js'

// ============================================================================
// Input Schema
// ============================================================================

const HONEST_UA =
  'GA4Manager-SEO-Auditor/1.0 (+https://github.com/garbarok/ga4-manager)'

export const seoPageAuditInputSchema = z.object({
  url: z
    .string()
    .url('url must be a valid URL')
    .describe('Fully-qualified URL to audit, e.g. "https://example.com/page"'),
  user_agent: z
    .string()
    .optional()
    .default(HONEST_UA)
    .describe(`User-Agent header sent with the request. Default: "${HONEST_UA}"`),
  check_cwv: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set true to fetch Core Web Vitals via PageSpeed Insights API'),
  psi_api_key: z
    .string()
    .optional()
    .describe('PageSpeed Insights API key (optional). Without key PSI rate-limits to ~1 req/100s'),
  psi_strategy: z
    .enum(['mobile', 'desktop'])
    .optional()
    .default('mobile')
    .describe('PSI analysis strategy. One of: "mobile" (default), "desktop"'),
})

export type SeoPageAuditInput = z.infer<typeof seoPageAuditInputSchema>

// Keep SeoSignals as alias so existing test imports work
export type SeoSignals = HtmlSignals
export type SeoIssueSummary = IssueSummary

// ============================================================================
// Output Types
// ============================================================================

export interface CwvData {
  lcp: number
  fcp: number
  cls: number
  tbt: number
  performance_score: number
  strategy: 'mobile' | 'desktop'
}

export interface SeoPageAuditOutput {
  success: boolean
  warnings: string[]
  url: string
  final_url: string
  status_code: number
  redirect_chain: RedirectHop[]
  signals: HtmlSignals
  issues: SeoIssue[]
  issue_summary: IssueSummary
  cwv?: CwvData
  cwv_error?: string
  error?: string
}

// ============================================================================
// PageSpeed Insights
// ============================================================================

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } }
    audits?: {
      'largest-contentful-paint'?: { numericValue?: number }
      'first-contentful-paint'?: { numericValue?: number }
      'cumulative-layout-shift'?: { numericValue?: number }
      'total-blocking-time'?: { numericValue?: number }
    }
  }
}

export async function fetchCwv(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string,
): Promise<CwvData> {
  const params = new URLSearchParams({ url, strategy, category: 'performance' })
  if (apiKey) params.set('key', apiKey)

  const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`
  const response = await fetch(psiUrl, { signal: AbortSignal.timeout(30000) })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PSI API error (HTTP ${response.status}): ${text}`)
  }

  const data = (await response.json()) as PsiResponse
  const lr = data.lighthouseResult
  const audits = lr?.audits ?? {}
  const perfScore = lr?.categories?.performance?.score ?? 0

  return {
    lcp: Math.round(audits['largest-contentful-paint']?.numericValue ?? 0),
    fcp: Math.round(audits['first-contentful-paint']?.numericValue ?? 0),
    cls: Math.round((audits['cumulative-layout-shift']?.numericValue ?? 0) * 1000) / 1000,
    tbt: Math.round(audits['total-blocking-time']?.numericValue ?? 0),
    performance_score: Math.round(perfScore * 100),
    strategy,
  }
}

// ============================================================================
// Meta-refresh extraction
// ============================================================================

function extractMetaRefreshUrl(html: string): string | null {
  // Matches: <meta http-equiv="refresh" content="5; url=https://example.com">
  // and reversed attribute order
  const match = html.match(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+http-equiv=["']refresh["']/i,
  )
  if (!match) return null
  const content = (match[1] ?? match[2] ?? '').trim()
  const urlMatch = content.match(/url\s*=\s*([^\s;,]+)/i)
  return urlMatch ? urlMatch[1] : null
}

// ============================================================================
// Main Tool Function
// ============================================================================

const FETCH_TIMEOUT_MS = 10_000

const emptySignals: HtmlSignals = {
  title: null,
  title_length: 0,
  description: null,
  description_length: 0,
  canonical: null,
  robots: null,
  noindex: false,
  og: { title: null, description: null, image: null, type: null },
  schema_types: [],
  h1_count: 0,
  h2_count: 0,
  hreflang_count: 0,
}

export async function runSeoPageAudit(input: SeoPageAuditInput): Promise<SeoPageAuditOutput> {
  const { url, user_agent, check_cwv, psi_api_key, psi_strategy } = input
  const warnings: string[] = []

  let finalUrl: string
  let statusCode: number
  let html: string
  let chain: RedirectHop[] = []

  try {
    const traceResult = await fetchWithTrace(url, {
      headers: { 'User-Agent': user_agent },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    chain = traceResult.chain
    finalUrl = traceResult.finalUrl
    statusCode = traceResult.finalRes.status
    html = await traceResult.finalRes.text()
  } catch (err) {
    if (err instanceof ToolError) {
      return {
        success: false,
        warnings,
        url,
        final_url: url,
        status_code: 0,
        redirect_chain: [],
        signals: emptySignals,
        issues: [],
        issue_summary: { errors: 0, warnings: 0, infos: 0 },
        error: err.message,
      }
    }
    const message =
      err instanceof Error
        ? err.name === 'TimeoutError'
          ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : String(err)
    return {
      success: false,
      warnings,
      url,
      final_url: url,
      status_code: 0,
      redirect_chain: [],
      signals: emptySignals,
      issues: [],
      issue_summary: { errors: 0, warnings: 0, infos: 0 },
      error: message,
    }
  }

  const signals = extractSignals(html, finalUrl)
  let issues = runIssueRules(signals, finalUrl, chain)

  if (statusCode < 200 || statusCode >= 300) {
    issues = [{ field: 'status', severity: 'error', message: `Page returned HTTP ${statusCode}` }, ...issues]
  }

  // Meta-refresh detection
  const metaRefreshUrl = extractMetaRefreshUrl(html)
  if (metaRefreshUrl) {
    issues.push({
      field: 'meta_refresh',
      severity: 'info',
      message: `Page has meta refresh redirect to: ${metaRefreshUrl}`,
    })
  }

  const issue_summary = summarizeIssues(issues)

  let cwv: CwvData | undefined
  let cwv_error: string | undefined

  if (check_cwv) {
    try {
      cwv = await fetchCwv(finalUrl, psi_strategy, psi_api_key)
    } catch (err) {
      cwv_error = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    success: true,
    warnings,
    url,
    final_url: finalUrl,
    status_code: statusCode,
    redirect_chain: chain,
    signals,
    issues,
    issue_summary,
    ...(cwv ? { cwv } : {}),
    ...(cwv_error ? { cwv_error } : {}),
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const seoPageAuditTool = {
  name: 'seo_page_audit',
  description:
    'Use when auditing a single page for SEO problems: missing title or description, bad canonical, noindex directives, missing OG image, heading structure issues, redirect chain problems. ' +
    'Fetches the URL with manual redirect tracing (max 5 hops), parses on-page signals (title, meta description, canonical, robots, Open Graph, Schema.org types, h1/h2 counts, hreflang). ' +
    'Returns a structured issues list with severity (error/warning/info) and the full redirect chain. ' +
    'Optionally checks Core Web Vitals via PageSpeed Insights API.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'Fully-qualified URL to audit, e.g. "https://example.com/page"',
      },
      user_agent: {
        type: 'string',
        description: `User-Agent header. Default: "${HONEST_UA}"`,
        default: HONEST_UA,
      },
      check_cwv: {
        type: 'boolean',
        description: 'Set true to fetch Core Web Vitals via PageSpeed Insights (default: false)',
        default: false,
      },
      psi_api_key: {
        type: 'string',
        description: 'PageSpeed Insights API key (optional — without key PSI rate-limits to ~1 req/100s)',
      },
      psi_strategy: {
        type: 'string',
        enum: ['mobile', 'desktop'],
        description: 'PSI analysis strategy. One of: "mobile" (default), "desktop"',
        default: 'mobile',
      },
    },
  },
}
