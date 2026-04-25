import { z } from 'zod'

// ============================================================================
// Input Schema
// ============================================================================

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

export const seoPageAuditInputSchema = z.object({
  /** URL to audit */
  url: z.string().url('url must be a valid URL'),
  /** User-Agent string (default: Googlebot UA) */
  user_agent: z.string().optional().default(GOOGLEBOT_UA),
  /** Whether to check Core Web Vitals via PageSpeed Insights */
  check_cwv: z.boolean().optional().default(false),
  /** PageSpeed Insights API key (optional) */
  psi_api_key: z.string().optional(),
  /** PSI strategy (default: mobile) */
  psi_strategy: z.enum(['mobile', 'desktop']).optional().default('mobile'),
})

export type SeoPageAuditInput = z.infer<typeof seoPageAuditInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface SeoIssue {
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface SeoIssueSummary {
  errors: number
  warnings: number
  infos: number
}

export interface SeoSignals {
  title: string | null
  title_length: number
  description: string | null
  description_length: number
  canonical: string | null
  robots: string | null
  noindex: boolean
  og: {
    title: string | null
    description: string | null
    image: string | null
    type: string | null
  }
  schema_types: string[]
  h1_count: number
  h2_count: number
  hreflang_count: number
}

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
  url: string
  final_url: string
  status_code: number
  signals: SeoSignals
  issues: SeoIssue[]
  issue_summary: SeoIssueSummary
  cwv?: CwvData
  cwv_error?: string
  error?: string
}

// ============================================================================
// Native HTML Signal Extraction
// ============================================================================

/**
 * Count all occurrences of a pattern
 */
function countMatches(html: string, pattern: RegExp): number {
  const matches = html.match(new RegExp(pattern.source, 'gi'))
  return matches ? matches.length : 0
}

/**
 * Extract the page title from HTML
 */
export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  return match[1].replace(/\s+/g, ' ').trim() || null
}

/**
 * Extract a meta tag content value
 */
export function extractMetaContent(
  html: string,
  name: string,
): string | null {
  // Match <meta name="..." content="..."> or <meta content="..." name="...">
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    'i',
  )
  const match = html.match(pattern)
  if (!match) return null
  return (match[1] ?? match[2] ?? null)?.trim() || null
}

/**
 * Extract the canonical URL
 */
export function extractCanonical(html: string): string | null {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
  )
  if (!match) return null
  return (match[1] ?? match[2] ?? null)?.trim() || null
}

/**
 * Count hreflang link tags
 */
export function countHreflang(html: string): number {
  return countMatches(html, /<link[^>]+hreflang=/i)
}

/**
 * Extract all JSON-LD @type values
 */
export function extractSchemaTypes(html: string): string[] {
  const types: string[] = []
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown> | unknown[]
      const extractType = (obj: unknown): void => {
        if (Array.isArray(obj)) {
          obj.forEach(extractType)
        } else if (obj && typeof obj === 'object') {
          const record = obj as Record<string, unknown>
          if (record['@type']) {
            const t = record['@type']
            if (Array.isArray(t)) {
              types.push(...(t as string[]))
            } else if (typeof t === 'string') {
              types.push(t)
            }
          }
          // Also check @graph
          if (Array.isArray(record['@graph'])) {
            record['@graph'].forEach(extractType)
          }
        }
      }
      extractType(parsed)
    } catch {
      // Invalid JSON-LD — skip
    }
  }

  return [...new Set(types)] // deduplicate
}

/**
 * Extract all SEO signals from HTML
 */
export function extractSignals(html: string, _finalUrl: string): SeoSignals {
  const title = extractTitle(html)
  const description = extractMetaContent(html, 'description')
  const canonical = extractCanonical(html)
  const robots = extractMetaContent(html, 'robots')

  const og = {
    title: extractMetaContent(html, 'og:title'),
    description: extractMetaContent(html, 'og:description'),
    image: extractMetaContent(html, 'og:image'),
    type: extractMetaContent(html, 'og:type'),
  }

  const schema_types = extractSchemaTypes(html)
  const h1_count = countMatches(html, /<h1[\s>]/i)
  const h2_count = countMatches(html, /<h2[\s>]/i)
  const hreflang_count = countHreflang(html)

  const noindex = robots ? /noindex/i.test(robots) : false

  return {
    title,
    title_length: title ? title.length : 0,
    description,
    description_length: description ? description.length : 0,
    canonical,
    robots,
    noindex,
    og,
    schema_types,
    h1_count,
    h2_count,
    hreflang_count,
  }
}

// ============================================================================
// Issue Rules
// ============================================================================

/**
 * Run issue detection rules against signals
 */
export function detectIssues(
  signals: SeoSignals,
  finalUrl: string,
): SeoIssue[] {
  const issues: SeoIssue[] = []

  // Title rules
  if (!signals.title) {
    issues.push({
      field: 'title',
      severity: 'error',
      message: 'Page is missing a <title> tag',
    })
  } else {
    if (signals.title_length < 10) {
      issues.push({
        field: 'title',
        severity: 'warning',
        message: `Title is too short (${signals.title_length} chars, minimum 10)`,
      })
    } else if (signals.title_length > 60) {
      issues.push({
        field: 'title',
        severity: 'warning',
        message: `Title may be truncated in SERPs (${signals.title_length} chars, max 60)`,
      })
    }
  }

  // Description rules
  if (!signals.description) {
    issues.push({
      field: 'description',
      severity: 'warning',
      message: 'Page is missing a meta description',
    })
  } else if (signals.description_length > 160) {
    issues.push({
      field: 'description',
      severity: 'warning',
      message: `Meta description may be truncated (${signals.description_length} chars, max 160)`,
    })
  }

  // Canonical rules
  if (!signals.canonical) {
    issues.push({
      field: 'canonical',
      severity: 'warning',
      message: 'Page is missing a canonical link tag',
    })
  } else {
    // Check if canonical points to a different domain
    try {
      const canonicalHost = new URL(signals.canonical).hostname
      const finalHost = new URL(finalUrl).hostname
      if (canonicalHost !== finalHost) {
        issues.push({
          field: 'canonical',
          severity: 'error',
          message: `Canonical points to different domain: ${signals.canonical}`,
        })
      }
    } catch {
      // Invalid URL in canonical — flag as warning
      issues.push({
        field: 'canonical',
        severity: 'warning',
        message: `Canonical URL appears invalid: ${signals.canonical}`,
      })
    }
  }

  // Robots rules
  if (signals.noindex) {
    issues.push({
      field: 'robots',
      severity: 'error',
      message: `Page has noindex directive: ${signals.robots}`,
    })
  }

  // H1 rules
  if (signals.h1_count === 0) {
    issues.push({
      field: 'h1',
      severity: 'warning',
      message: 'Page has no <h1> tag',
    })
  } else if (signals.h1_count > 1) {
    issues.push({
      field: 'h1',
      severity: 'warning',
      message: `Page has multiple <h1> tags (${signals.h1_count})`,
    })
  }

  // OG image
  if (!signals.og.image) {
    issues.push({
      field: 'og:image',
      severity: 'info',
      message: 'Page is missing og:image meta tag',
    })
  }

  return issues
}

/**
 * Summarize issues by severity
 */
export function summarizeIssues(issues: SeoIssue[]): SeoIssueSummary {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  }
}

// ============================================================================
// PageSpeed Insights
// ============================================================================

interface PsiResponse {
  lighthouseResult?: {
    categories?: {
      performance?: { score?: number }
    }
    audits?: {
      'largest-contentful-paint'?: { numericValue?: number }
      'first-contentful-paint'?: { numericValue?: number }
      'cumulative-layout-shift'?: { numericValue?: number }
      'total-blocking-time'?: { numericValue?: number }
    }
  }
}

/**
 * Fetch Core Web Vitals from PageSpeed Insights API
 */
export async function fetchCwv(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey?: string,
): Promise<CwvData> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  })
  if (apiKey) {
    params.set('key', apiKey)
  }

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
// Main Tool Function
// ============================================================================

const FETCH_TIMEOUT_MS = 10_000

/**
 * Run the full seo_page_audit tool
 */
export async function runSeoPageAudit(
  input: SeoPageAuditInput,
): Promise<SeoPageAuditOutput> {
  const { url, user_agent, check_cwv, psi_api_key, psi_strategy } = input

  const emptySignals: SeoSignals = {
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

  let fetchResponse: Response
  let finalUrl: string
  let statusCode: number
  let html: string

  try {
    fetchResponse = await fetch(url, {
      headers: { 'User-Agent': user_agent },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    finalUrl = fetchResponse.url || url
    statusCode = fetchResponse.status
    html = await fetchResponse.text()
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === 'TimeoutError'
          ? `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : String(err)
    return {
      success: false,
      url,
      final_url: url,
      status_code: 0,
      signals: emptySignals,
      issues: [],
      issue_summary: { errors: 0, warnings: 0, infos: 0 },
      error: message,
    }
  }

  // Extract signals even for non-2xx (still parse what we have)
  const signals = extractSignals(html, finalUrl)
  let issues = detectIssues(signals, finalUrl)

  // Flag non-2xx status as an issue
  if (statusCode < 200 || statusCode >= 300) {
    issues = [
      {
        field: 'status',
        severity: 'error',
        message: `Page returned HTTP ${statusCode}`,
      },
      ...issues,
    ]
  }

  const issue_summary = summarizeIssues(issues)

  // Core Web Vitals (optional)
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
    url,
    final_url: finalUrl,
    status_code: statusCode,
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
    'Fetch a URL as Googlebot and audit on-page SEO signals: title, meta description, canonical, robots, Open Graph, Schema.org types, h1/h2 counts, hreflang. ' +
    'Returns structured issues list with severity (error/warning/info). ' +
    'Optionally checks Core Web Vitals via PageSpeed Insights API.',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'URL to audit (must be publicly accessible)',
      },
      user_agent: {
        type: 'string',
        description: `User-Agent string for the request (default: Googlebot UA)`,
        default: GOOGLEBOT_UA,
      },
      check_cwv: {
        type: 'boolean',
        description:
          'Check Core Web Vitals via PageSpeed Insights API (default: false)',
        default: false,
      },
      psi_api_key: {
        type: 'string',
        description:
          'PageSpeed Insights API key (optional — PSI works without key but rate-limits at ~1 req/100s)',
      },
      psi_strategy: {
        type: 'string',
        enum: ['mobile', 'desktop'],
        description: 'PSI analysis strategy (default: mobile)',
        default: 'mobile',
      },
    },
  },
}
