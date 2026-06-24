import { z } from 'zod'
import {
  runSeoPageAudit,
  seoPageAuditInputSchema,
  type SeoPageAuditOutput,
} from './seo-page-audit.js'

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const HONEST_UA =
  'GA4Manager-SEO-Auditor/1.0 (+https://github.com/garbarok/ga4-manager)'

// ============================================================================
// Input Schema
// ============================================================================

export const seoAuditBatchInputSchema = z
  .object({
    urls: z
      .array(z.string().url())
      .optional()
      .describe('Explicit list of URLs to audit'),
    sitemap: z
      .string()
      .url()
      .optional()
      .describe('Sitemap URL to expand into URLs (sitemap-index files are followed)'),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .default(50)
      .describe('Maximum number of URLs to audit (default 50, max 500)'),
    concurrency: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .default(5)
      .describe('Concurrent audits (default 5). Same-host requests are still throttled to 1/sec.'),
    check_cwv: z
      .boolean()
      .optional()
      .default(false)
      .describe('Fetch Core Web Vitals via PageSpeed Insights for each URL (needs a PSI key; slow)'),
    psi_strategy: z.enum(['mobile', 'desktop']).optional().default('mobile'),
    psi_api_key: z
      .string()
      .optional()
      .describe('PSI API key. Falls back to the PSI_API_KEY env var when omitted.'),
    respect_robots: z.boolean().optional().default(true),
    as_googlebot: z
      .boolean()
      .optional()
      .default(true)
      .describe('Identify as Googlebot so CDNs that challenge unknown agents still answer (default true)'),
  })
  .refine((d) => (d.urls && d.urls.length > 0) || d.sitemap, {
    message: 'provide either urls[] or sitemap',
  })

export type SeoAuditBatchInput = z.infer<typeof seoAuditBatchInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface SeoAuditBatchSummary {
  audited: number
  clean: number // pages with no error-severity issues and a 2xx status
  pages_with_errors: number
  total_error_issues: number
  failed_fetch: number
}

export interface SeoAuditBatchOutput {
  success: boolean
  total_candidates: number
  truncated: boolean
  summary: SeoAuditBatchSummary
  results: SeoPageAuditOutput[]
  warnings: string[]
  error?: string
}

// ============================================================================
// Sitemap fetch + parse (regex-based; dependency-free)
// ============================================================================

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
const SITEMAP_BLOCK_RE = /<sitemap>[\s\S]*?<\/sitemap>/gi

async function fetchSitemapUrls(
  sitemapUrl: string,
  ua: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 3) return [] // guard against pathological nesting/cycles
  const res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': ua },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`failed to fetch sitemap ${sitemapUrl}: HTTP ${res.status}`)
  }
  const xml = await res.text()

  // A <sitemapindex> contains <sitemap><loc> entries pointing at child sitemaps.
  const indexBlocks = xml.match(SITEMAP_BLOCK_RE)
  if (indexBlocks && indexBlocks.length > 0) {
    const children: string[] = []
    for (const block of indexBlocks) {
      const m = LOC_RE.exec(block)
      LOC_RE.lastIndex = 0
      if (m) children.push(m[1].trim())
    }
    const all: string[] = []
    for (const child of children) {
      try {
        all.push(...(await fetchSitemapUrls(child, ua, depth + 1)))
      } catch {
        // skip a bad child sitemap rather than failing the whole expansion
      }
    }
    return all
  }

  // Otherwise treat every <loc> as a page URL.
  const urls: string[] = []
  let m: RegExpExecArray | null
  LOC_RE.lastIndex = 0
  while ((m = LOC_RE.exec(xml)) !== null) {
    urls.push(m[1].trim())
  }
  return urls
}

// ============================================================================
// Bounded concurrency pool
// ============================================================================

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

// ============================================================================
// Main Tool Function
// ============================================================================

export async function runSeoAuditBatch(
  input: SeoAuditBatchInput,
): Promise<SeoAuditBatchOutput> {
  const warnings: string[] = []
  const ua = input.as_googlebot ? GOOGLEBOT_UA : HONEST_UA

  let candidates: string[] = [...(input.urls ?? [])]
  if (input.sitemap) {
    try {
      candidates.push(...(await fetchSitemapUrls(input.sitemap, ua)))
    } catch (err) {
      return {
        success: false,
        total_candidates: 0,
        truncated: false,
        summary: emptySummary(),
        results: [],
        warnings,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Deduplicate while preserving order.
  candidates = [...new Set(candidates)]
  const totalCandidates = candidates.length
  const truncated = totalCandidates > input.limit
  if (truncated) {
    candidates = candidates.slice(0, input.limit)
    warnings.push(
      `truncated to ${input.limit} of ${totalCandidates} URLs; raise --limit to audit more`,
    )
  }

  const results = await runPool(candidates, input.concurrency, (url) => {
    // Reuse the single-page auditor so behaviour stays identical. Parse through
    // the page schema to apply its defaults (user_agent, force_refresh, etc.).
    const pageInput = seoPageAuditInputSchema.parse({
      url,
      check_cwv: input.check_cwv,
      psi_strategy: input.psi_strategy,
      psi_api_key: input.psi_api_key,
      respect_robots: input.respect_robots,
      as_googlebot: input.as_googlebot,
    })
    return runSeoPageAudit(pageInput)
  })

  return {
    success: true,
    total_candidates: totalCandidates,
    truncated,
    summary: summarize(results),
    results,
    warnings,
  }
}

function emptySummary(): SeoAuditBatchSummary {
  return { audited: 0, clean: 0, pages_with_errors: 0, total_error_issues: 0, failed_fetch: 0 }
}

function summarize(results: SeoPageAuditOutput[]): SeoAuditBatchSummary {
  const s = emptySummary()
  s.audited = results.length
  for (const r of results) {
    if (!r.success) {
      s.failed_fetch++
      continue
    }
    const errs = r.issue_summary?.errors ?? 0
    s.total_error_issues += errs
    if (errs > 0) {
      s.pages_with_errors++
    } else {
      s.clean++
    }
  }
  return s
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const seoAuditBatchTool = {
  name: 'seo_audit_batch',
  description:
    'Audit many pages at once for SEO problems (missing title/description, bad canonical, noindex, redirect issues, HTTP errors). ' +
    'Provide an explicit urls[] list and/or a sitemap URL (sitemap-index files are followed and expanded). ' +
    'Runs the single-page auditor over each URL with bounded concurrency, fetching each supplied URL over HTTP, and returns per-URL results plus a summary. ' +
    'Optionally fetches Core Web Vitals via PageSpeed Insights (needs a PSI key; set PSI_API_KEY or pass psi_api_key).',
  inputSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit list of URLs to audit',
      },
      sitemap: {
        type: 'string',
        description: 'Sitemap URL to expand into URLs (sitemap-index files are followed)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of URLs to audit (default 50, max 500)',
        default: 50,
      },
      concurrency: {
        type: 'number',
        description: 'Concurrent audits (default 5). Same-host requests are still throttled to 1/sec.',
        default: 5,
      },
      check_cwv: {
        type: 'boolean',
        description: 'Fetch Core Web Vitals via PageSpeed Insights for each URL (needs a PSI key; slow)',
        default: false,
      },
      psi_strategy: {
        type: 'string',
        enum: ['mobile', 'desktop'],
        default: 'mobile',
      },
      psi_api_key: {
        type: 'string',
        description: 'PSI API key. Falls back to the PSI_API_KEY env var when omitted.',
      },
      respect_robots: {
        type: 'boolean',
        description: 'Respect robots.txt disallow rules before fetching (default: true)',
        default: true,
      },
      as_googlebot: {
        type: 'boolean',
        description: 'Identify as Googlebot so CDNs that challenge unknown agents still answer (default: true)',
        default: true,
      },
    },
  },
  annotations: { title: 'Batch SEO page audit', readOnlyHint: true, openWorldHint: true },
}
