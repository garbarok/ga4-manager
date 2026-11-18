import { isIndexable } from './site-issues.js'
import type { CrawledPage } from './crawler.js'

/**
 * Lighthouse for a handful of representative pages, through the PageSpeed
 * Insights API (free; PSI_API_KEY lifts the shared quota). Per page and
 * strategy: category scores, lab LCP/CLS/TBT/TTFB, field LCP/CLS/INP/TTFB when
 * Chrome UX Report has data (INP only exists as field data), and the top
 * savings opportunities with the resources behind them.
 */

export type Strategy = 'mobile' | 'desktop'

export interface Saving {
  id: string
  title: string
  savings_ms: number
  savings_bytes: number
  resources: { url: string; wasted_ms?: number; wasted_bytes?: number; total_bytes?: number }[]
}

export interface LighthouseRun {
  url: string
  strategy: Strategy
  fetched_at: string
  scores: { performance: number | null; accessibility: number | null; best_practices: number | null; seo: number | null }
  lab: { lcp_ms: number | null; cls: number | null; tbt_ms: number | null; ttfb_ms: number | null; fcp_ms: number | null }
  /** Chrome UX Report p75 values (28 days); null when the page/origin has too little traffic. */
  field: { source: 'url' | 'origin' | null; lcp_ms: number | null; cls: number | null; inp_ms: number | null; ttfb_ms: number | null }
  top_savings: Saving[]
  error?: string
}

interface PsiAudit {
  title?: string
  numericValue?: number
  details?: {
    type?: string
    overallSavingsMs?: number
    overallSavingsBytes?: number
    items?: { url?: string; wastedMs?: number; wastedBytes?: number; totalBytes?: number }[] | Record<string, unknown>
  }
  metricSavings?: Record<string, number>
}

interface PsiMetric {
  percentile?: number
}

export interface PsiResponse {
  loadingExperience?: { id?: string; metrics?: Record<string, PsiMetric> }
  originLoadingExperience?: { metrics?: Record<string, PsiMetric> }
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>
    audits?: Record<string, PsiAudit>
  }
}

/**
 * Pick up to `n` pages: the start URL, then the most-linked indexable page of
 * each top-level section (first path segment), then the most-linked rest.
 */
export function pickRepresentativePages(pages: CrawledPage[], startUrl: string, n: number): string[] {
  const candidates = pages.filter(isIndexable).sort((a, b) => b.inlinks - a.inlinks || a.url.localeCompare(b.url))
  const out: string[] = []
  const push = (u: string): void => {
    if (out.length < n && !out.includes(u)) out.push(u)
  }
  const start = candidates.find((p) => p.url === startUrl)
  if (start) push(start.url)
  const seenSection = new Set<string>()
  for (const p of candidates) {
    const section = new URL(p.url).pathname.split('/').filter(Boolean)[0] ?? ''
    if (seenSection.has(section)) continue
    seenSection.add(section)
    push(p.url)
  }
  for (const p of candidates) push(p.url)
  return out
}

const round = (n: number | undefined, digits = 0): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : null

const score = (s: number | null | undefined): number | null => (typeof s === 'number' ? Math.round(s * 100) : null)

export function parsePsi(url: string, strategy: Strategy, data: PsiResponse, now: Date = new Date()): LighthouseRun {
  const audits = data.lighthouseResult?.audits ?? {}
  const cats = data.lighthouseResult?.categories ?? {}
  const urlField = data.loadingExperience?.metrics
  const originField = data.originLoadingExperience?.metrics
  const useUrl = urlField && Object.keys(urlField).length > 0 && !data.loadingExperience?.id?.startsWith('origin:')
  const field = useUrl ? urlField : originField
  const fieldVal = (key: string, digits = 0, scale = 1): number | null => {
    const p = field?.[key]?.percentile
    return typeof p === 'number' ? round(p / scale, digits) : null
  }

  const savings: Saving[] = Object.entries(audits)
    .map(([id, a]) => ({
      id,
      title: a.title ?? id,
      savings_ms: Math.round(a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? 0),
      savings_bytes: Math.round(a.details?.overallSavingsBytes ?? 0),
      resources: (Array.isArray(a.details?.items) ? a.details!.items! : [])
        .filter((it) => typeof it?.url === 'string')
        .slice(0, 5)
        .map((it) => ({
          url: it.url!,
          ...(it.wastedMs !== undefined ? { wasted_ms: Math.round(it.wastedMs) } : {}),
          ...(it.wastedBytes !== undefined ? { wasted_bytes: Math.round(it.wastedBytes) } : {}),
          ...(it.totalBytes !== undefined ? { total_bytes: Math.round(it.totalBytes) } : {}),
        })),
    }))
    .filter((s) => s.savings_ms > 0 || s.savings_bytes > 0)
    .sort((a, b) => b.savings_ms - a.savings_ms || b.savings_bytes - a.savings_bytes)
    .slice(0, 5)

  return {
    url,
    strategy,
    fetched_at: now.toISOString(),
    scores: {
      performance: score(cats.performance?.score),
      accessibility: score(cats.accessibility?.score),
      best_practices: score(cats['best-practices']?.score),
      seo: score(cats.seo?.score),
    },
    lab: {
      lcp_ms: round(audits['largest-contentful-paint']?.numericValue),
      cls: round(audits['cumulative-layout-shift']?.numericValue, 3),
      tbt_ms: round(audits['total-blocking-time']?.numericValue),
      ttfb_ms: round(audits['server-response-time']?.numericValue),
      fcp_ms: round(audits['first-contentful-paint']?.numericValue),
    },
    field: {
      source: field ? (useUrl ? 'url' : 'origin') : null,
      lcp_ms: fieldVal('LARGEST_CONTENTFUL_PAINT_MS'),
      cls: fieldVal('CUMULATIVE_LAYOUT_SHIFT_SCORE', 3, 100),
      inp_ms: fieldVal('INTERACTION_TO_NEXT_PAINT'),
      ttfb_ms: fieldVal('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    },
    top_savings: savings,
  }
}

export type PsiFetcher = (url: string, strategy: Strategy) => Promise<PsiResponse>

export const psiFetcher: PsiFetcher = async (url, strategy) => {
  const params = new URLSearchParams({ url, strategy })
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', c)
  if (process.env.PSI_API_KEY) params.set('key', process.env.PSI_API_KEY)
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 429) throw new Error(`PageSpeed Insights quota exceeded (HTTP 429). Set PSI_API_KEY to use your own quota.`)
    throw new Error(`PageSpeed Insights error (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }
  return (await res.json()) as PsiResponse
}

export async function runLighthouse(
  urls: string[],
  strategies: Strategy[],
  fetcher: PsiFetcher = psiFetcher,
  opts: { concurrency?: number; onDone?: (run: LighthouseRun) => void } = {},
): Promise<LighthouseRun[]> {
  const jobs = urls.flatMap((url) => strategies.map((strategy) => ({ url, strategy })))
  const results: LighthouseRun[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const { url, strategy } = jobs[next++]
      let run: LighthouseRun
      try {
        run = parsePsi(url, strategy, await fetcher(url, strategy))
      } catch (err) {
        run = {
          url,
          strategy,
          fetched_at: new Date().toISOString(),
          scores: { performance: null, accessibility: null, best_practices: null, seo: null },
          lab: { lcp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null, fcp_ms: null },
          field: { source: null, lcp_ms: null, cls: null, inp_ms: null, ttfb_ms: null },
          top_savings: [],
          error: err instanceof Error ? err.message : String(err),
        }
      }
      results.push(run)
      opts.onDone?.(run)
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, jobs.length) }, worker))
  const order = new Map(jobs.map((j, i) => [`${j.url}|${j.strategy}`, i]))
  return results.sort((a, b) => order.get(`${a.url}|${a.strategy}`)! - order.get(`${b.url}|${b.strategy}`)!)
}
