import Bottleneck from 'bottleneck'
import { z } from 'zod'
import { extractSignals, type HtmlSignals } from './html-signals.js'
import { runIssueRules, summarizeIssues, type SeoIssue, type IssueSummary } from './issue-rules.js'
import { fetchWithTrace, type RedirectHop } from '../utils/redirect-trace.js'
import { ToolError } from '../utils/errors.js'
import { isAllowed as robotsIsAllowed } from '../utils/robots-check.js'
import { TTLCache } from '../utils/cache.js'

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

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

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
  respect_robots: z
    .boolean()
    .optional()
    .default(true)
    .describe('Respect robots.txt disallow rules (default: true). Set false to bypass.'),
  as_googlebot: z
    .boolean()
    .optional()
    .default(false)
    .describe('Override user_agent with the standard Googlebot UA string (default: false)'),
  force_refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe('Bypass the 5-minute PSI cache and fetch fresh Core Web Vitals data (default: false)'),
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
  blocked_by_robots?: true
  warnings: string[]
  url: string
  final_url: string
  status_code: number
  redirect_chain: RedirectHop[]
  signals: HtmlSignals | null
  issues: SeoIssue[]
  issue_summary: IssueSummary
  cwv?: CwvData
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

    // Detect the "zero per-project daily quota" trap that hits unauthenticated
    // PSI calls when Google attributes them to the caller's gcloud project.
    // Free tier with API key has 25k/day; without key the project default is 0.
    if (
      response.status === 429 &&
      (text.includes('"quota_limit_value": "0"') ||
        text.includes('"quota_limit_value":"0"'))
    ) {
      throw new Error(
        'PSI returned 429 with per-project daily quota = 0. ' +
          'Create a free PSI API key (Cloud Console → Credentials → Create credentials → API key, restrict to PageSpeed Insights API) and pass it via the psi_api_key input. ' +
          'See mcp/TROUBLESHOOTING.md → "PSI returns 429 quota_limit_value=0".',
      )
    }

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
// PSI cache + keyless throttle
// ============================================================================

// 5-minute TTL; keyed by `${url}|${strategy}`
export const psiCache = new TTLCache<CwvData>(5 * 60 * 1000)

// When no API key, PSI rate-limits to ~1 req/100s. A single shared limiter enforces this.
const keylessPsiLimiter = new Bottleneck({ minTime: 100_000, maxConcurrent: 1 })

// ============================================================================
// Per-host throttle (1 req/sec per hostname, scoped to MCP session lifetime)
// ============================================================================

const hostLimiters = new Map<string, Bottleneck>()

function getLimiter(hostname: string): Bottleneck {
  let limiter = hostLimiters.get(hostname)
  if (!limiter) {
    limiter = new Bottleneck({ minTime: 1000, maxConcurrent: 1 })
    hostLimiters.set(hostname, limiter)
  }
  return limiter
}

// ============================================================================
// Main Tool Function
// ============================================================================

const FETCH_TIMEOUT_MS = 10_000

const emptySignals: HtmlSignals = {
  title: null,
  title_length: 0,
  title_estimated_pixels: 0,
  description: null,
  description_length: 0,
  description_estimated_pixels: 0,
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
  const { url, check_cwv, psi_api_key, psi_strategy, respect_robots, as_googlebot, force_refresh } = input
  const effectiveUA = as_googlebot ? GOOGLEBOT_UA : input.user_agent
  const warnings: string[] = []

  // Robots check before fetching
  if (respect_robots) {
    const allowed = await robotsIsAllowed(url, effectiveUA)
    if (!allowed) {
      return {
        success: true,
        blocked_by_robots: true,
        warnings: [`robots.txt disallows crawling ${url} with UA "${effectiveUA}"`],
        url,
        final_url: url,
        status_code: 0,
        redirect_chain: [],
        signals: null,
        issues: [],
        issue_summary: { errors: 0, warnings: 0, infos: 0 },
      }
    }
  }

  const limiter = getLimiter(new URL(url).hostname)

  let finalUrl: string
  let statusCode: number
  let html: string
  let chain: RedirectHop[]

  try {
    const traceResult = await limiter.schedule(() =>
      fetchWithTrace(url, {
        headers: { 'User-Agent': effectiveUA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    )
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

  if (check_cwv) {
    const cacheKey = `${finalUrl}|${psi_strategy}`
    if (!force_refresh) {
      cwv = psiCache.get(cacheKey)
    }
    if (!cwv) {
      try {
        const doFetch = () => fetchCwv(finalUrl, psi_strategy, psi_api_key)
        cwv = psi_api_key ? await doFetch() : await keylessPsiLimiter.schedule(doFetch)
        psiCache.set(cacheKey, cwv)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        warnings.push(`psi_unavailable: ${reason}`)
      }
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
      respect_robots: {
        type: 'boolean',
        description: 'Respect robots.txt disallow rules before fetching (default: true)',
        default: true,
      },
      as_googlebot: {
        type: 'boolean',
        description: 'Override user_agent with the standard Googlebot UA string (default: false)',
        default: false,
      },
      force_refresh: {
        type: 'boolean',
        description: 'Bypass the 5-minute PSI cache and fetch fresh Core Web Vitals data (default: false)',
        default: false,
      },
    },
  },
}
