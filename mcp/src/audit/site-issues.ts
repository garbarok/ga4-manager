import { estimatePixelWidth } from '../utils/pixel-width.js'
import { hammingHex, type CrawlResult, type CrawledPage } from './crawler.js'

/**
 * Site-wide issues from a crawl. Pure: a CrawlResult in, issues out.
 * Every issue type has a fixed severity rule and a concrete how_to_fix.
 */

export type Severity = 'error' | 'warning' | 'notice'

export interface IssuePage {
  url: string
  detail?: string
}

export interface SiteIssue {
  type: string
  severity: Severity
  title: string
  how_to_fix: string
  count: number
  pages: IssuePage[]
}

export interface IssueThresholds {
  thin_words: number
  slow_ms: number
  deep_depth: number
  title_min: number
  title_max: number
  title_max_px: number
  description_min: number
  description_max: number
  /** Max differing simhash bits for near-duplicate content. */
  near_duplicate_bits: number
}

export const DEFAULT_THRESHOLDS: IssueThresholds = {
  thin_words: 200,
  slow_ms: 1000,
  deep_depth: 3,
  title_min: 30,
  title_max: 60,
  title_max_px: 580,
  description_min: 70,
  description_max: 160,
  near_duplicate_bits: 3,
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, notice: 2 }

/** A crawled HTML page that answered 200 (not a redirect, not blocked). */
export function isContentPage(p: CrawledPage): boolean {
  return p.status_kind === 'ok' && p.content_type !== null && /html/i.test(p.content_type)
}

/** A content page that search engines may index. */
export function isIndexable(p: CrawledPage): boolean {
  return isContentPage(p) && !p.noindex && (p.canonicals.length === 0 || p.canonicals.includes(p.url))
}

function quote(s: string, max = 70): string {
  return `"${s.length > max ? s.slice(0, max - 1) + '…' : s}"`
}

class IssueSet {
  private readonly map = new Map<string, SiteIssue>()
  add(type: string, severity: Severity, title: string, howToFix: string, page?: IssuePage): void {
    const issue = this.map.get(type) ?? { type, severity, title, how_to_fix: howToFix, count: 0, pages: [] }
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[issue.severity]) issue.severity = severity
    if (page) {
      issue.pages.push(page)
      issue.count += 1
    }
    this.map.set(type, issue)
  }
  notice(type: string, title: string, howToFix: string, detail: string): void {
    this.map.set(type, { type, severity: 'notice', title, how_to_fix: howToFix, count: 1, pages: [{ url: '', detail }] })
  }
  list(): SiteIssue[] {
    return [...this.map.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.type.localeCompare(b.type))
  }
}

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (k === null) continue
    const arr = out.get(k) ?? []
    arr.push(it)
    out.set(k, arr)
  }
  return out
}

export function analyzeSite(crawl: CrawlResult, t: IssueThresholds = DEFAULT_THRESHOLDS): SiteIssue[] {
  const issues = new IssueSet()
  const byUrl = new Map(crawl.pages.map((p) => [p.url, p]))
  const content = crawl.pages.filter(isContentPage)
  const indexable = content.filter(isIndexable)

  // Who links to each URL (for broken-link sources).
  const sources = new Map<string, string[]>()
  for (const p of crawl.pages) for (const l of p.internal_links) if (l !== p.url) sources.set(l, [...(sources.get(l) ?? []), p.url])
  const linkedFrom = (u: string): string => {
    const s = sources.get(u) ?? []
    return s.length ? ` Linked from ${s.length} page(s): ${s.slice(0, 3).join(', ')}${s.length > 3 ? ', …' : ''}` : ''
  }

  // ---- broken internal links (direct, or through a redirect) -------------
  const brokenFix = 'Update or remove the links that point here, or restore the page / add a 301 to the closest live page.'
  for (const p of crawl.pages) {
    if (p.status_kind === 'client_error' || p.status_kind === 'server_error') {
      if (p.inlinks > 0 || p.found_via === 'start') {
        issues.add('broken-internal-link', 'error', 'Internal links to broken pages', brokenFix, { url: p.url, detail: `HTTP ${p.status}.${linkedFrom(p.url)}` })
      }
    }
    if (p.status_kind === 'redirect' && !p.redirect_loop && p.final_url !== p.url) {
      const target = byUrl.get(p.final_url)
      if (target && (target.status_kind === 'client_error' || target.status_kind === 'server_error') && p.inlinks > 0) {
        issues.add('broken-internal-link', 'error', 'Internal links to broken pages', brokenFix, {
          url: p.url,
          detail: `Redirects to ${p.final_url}, which returns HTTP ${target.status}.${linkedFrom(p.url)}`,
        })
      }
    }
    if (p.status_kind === 'fetch_error' && (p.inlinks > 0 || p.found_via === 'start')) {
      issues.add('unreachable-page', 'warning', 'Pages that could not be fetched', 'Check the server logs for timeouts or TLS errors on these URLs; re-run the audit to rule out a transient failure.', {
        url: p.url,
        detail: p.error ?? 'network error',
      })
    }
  }

  // ---- redirects --------------------------------------------------------
  for (const p of crawl.pages) {
    if (p.redirect_loop) {
      issues.add('redirect-loop', 'error', 'Redirect loops', 'Break the loop: make the URL either serve content (200) or redirect once to a final page that returns 200.', {
        url: p.url,
        detail: p.redirect_chain.map((h) => `${h.url} (${h.status})`).join(' → '),
      })
    } else if (p.redirect_chain.length >= 2) {
      issues.add('redirect-chain', 'warning', 'Redirect chains (2+ hops)', 'Point the first URL straight at the final destination with a single 301, and update internal links to the final URL.', {
        url: p.url,
        detail: [...p.redirect_chain.map((h) => `${h.url} (${h.status})`), p.final_url].join(' → '),
      })
    }
    if (p.status_kind === 'redirect' && p.inlinks > 0 && !p.redirect_loop) {
      issues.add('internal-link-to-redirect', 'notice', 'Internal links that go through a redirect', 'Change internal links to point at the final URL so crawlers and users skip the hop.', {
        url: p.url,
        detail: `→ ${p.final_url}.${linkedFrom(p.url)}`,
      })
    }
  }

  // ---- link structure ---------------------------------------------------
  const finalTargets = new Map<string, number>()
  for (const p of crawl.pages) if (p.status_kind === 'redirect' && p.inlinks > 0) finalTargets.set(p.final_url, (finalTargets.get(p.final_url) ?? 0) + p.inlinks)
  for (const p of content) {
    const isStart = p.url === crawl.final_start_url
    if (p.in_sitemap && !isStart && p.inlinks === 0 && !finalTargets.has(p.url)) {
      issues.add('orphan-page', 'warning', 'Orphan pages (in the sitemap, no internal links)', 'Link to the page from a relevant hub or navigation page, or drop it from the sitemap if it is retired.', { url: p.url })
    }
    const out = p.internal_links.filter((l) => l !== p.url)
    if (out.length === 0) {
      issues.add('no-outgoing-links', 'warning', 'Pages with no internal links out', 'Add contextual links to related pages and to the parent hub so link equity and crawlers can flow onward.', { url: p.url })
    }
    if (p.depth !== null && p.depth > t.deep_depth) {
      issues.add('deep-page', 'warning', `Pages more than ${t.deep_depth} clicks from the start URL`, 'Link to the page from a hub, category or the home page so it sits within three clicks.', {
        url: p.url,
        detail: `click depth ${p.depth}`,
      })
    }
  }

  // ---- titles & descriptions --------------------------------------------
  for (const p of content) {
    if (!p.title) issues.add('missing-title', 'error', 'Missing <title>', 'Add a unique, descriptive <title> (30–60 characters) that leads with the page topic.', { url: p.url })
    else {
      const px = estimatePixelWidth(p.title)
      if (p.title.length > t.title_max || px > t.title_max_px) {
        issues.add('title-too-long', 'warning', `Titles over ${t.title_max} characters / ${t.title_max_px}px`, 'Shorten the title so it is not truncated in results: keep the topic and brand, drop filler.', {
          url: p.url,
          detail: `${p.title.length} chars, ~${px}px: ${quote(p.title)}`,
        })
      } else if (p.title.length < t.title_min) {
        issues.add('title-too-short', 'notice', `Titles under ${t.title_min} characters`, 'Expand the title with the main query and a qualifier (who it is for, the benefit or the year).', {
          url: p.url,
          detail: `${p.title.length} chars: ${quote(p.title)}`,
        })
      }
    }
    if (!p.meta_description) {
      issues.add('missing-description', 'warning', 'Missing meta description', 'Write a 70–160 character description that summarises the page and gives a reason to click.', { url: p.url })
    } else if (p.meta_description.length > t.description_max) {
      issues.add('description-too-long', 'notice', `Meta descriptions over ${t.description_max} characters`, 'Trim the description so the key message survives truncation in results.', {
        url: p.url,
        detail: `${p.meta_description.length} chars`,
      })
    } else if (p.meta_description.length < t.description_min) {
      issues.add('description-too-short', 'notice', `Meta descriptions under ${t.description_min} characters`, 'Expand the description with what the page offers and a call to action.', {
        url: p.url,
        detail: `${p.meta_description.length} chars`,
      })
    }
  }
  const dupFix = (what: string): string => `Give each indexable page a unique ${what}, or consolidate the pages and canonicalise/redirect the duplicates.`
  for (const [, group] of groupBy(indexable, (p) => p.title?.toLowerCase().trim() || null)) {
    if (group.length < 2) continue
    for (const p of group) issues.add('duplicate-title', 'warning', 'Duplicate titles', dupFix('title'), { url: p.url, detail: `${group.length} pages share ${quote(p.title ?? '')}` })
  }
  for (const [, group] of groupBy(indexable, (p) => p.meta_description?.toLowerCase().trim() || null)) {
    if (group.length < 2) continue
    for (const p of group) issues.add('duplicate-meta-description', 'warning', 'Duplicate meta descriptions', dupFix('meta description'), { url: p.url, detail: `${group.length} pages share it` })
  }

  // ---- content ----------------------------------------------------------
  // Exact duplicates by hash, near duplicates by simhash; union-find into clusters.
  const candidates = indexable.filter((p) => p.word_count >= 50 && p.simhash)
  const parent = candidates.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      if (a.content_hash === b.content_hash || hammingHex(a.simhash!, b.simhash!) <= t.near_duplicate_bits) parent[find(j)] = find(i)
    }
  }
  const clusters = groupBy(candidates.map((p, i) => ({ p, root: find(i) })), (x) => String(x.root))
  for (const [, cluster] of clusters) {
    if (cluster.length < 2) continue
    for (const { p } of cluster) {
      issues.add('duplicate-content', 'warning', 'Duplicate or near-duplicate content', 'Merge the pages into one and 301 the others, or set a canonical to the primary version; if they must stay separate, make each substantively different.', {
        url: p.url,
        detail: `same content as ${cluster.filter((c) => c.p !== p).slice(0, 3).map((c) => c.p.url).join(', ')}`,
      })
    }
  }
  for (const p of indexable) {
    if (p.word_count < t.thin_words) {
      issues.add('thin-content', 'warning', `Thin content (under ${t.thin_words} words)`, 'Expand the page to fully answer its query (examples, specifics, FAQs), merge it into a stronger page, or noindex it if it has no search purpose.', {
        url: p.url,
        detail: `${p.word_count} words`,
      })
    }
  }

  // ---- headings & images ------------------------------------------------
  for (const p of content) {
    if (p.h1.length === 0) issues.add('missing-h1', 'warning', 'Missing H1', 'Add one H1 that states the page topic (it can match the title).', { url: p.url })
    else if (p.h1.length > 1) {
      issues.add('multiple-h1', 'notice', 'More than one H1', 'Keep a single H1 for the page topic and demote the others to H2.', { url: p.url, detail: `${p.h1.length} H1s` })
    }
    for (let i = 1; i < p.headings.length; i++) {
      const prev = p.headings[i - 1]
      const cur = p.headings[i]
      if (cur.level - prev.level > 1) {
        issues.add('heading-order-skip', 'notice', 'Heading levels skipped (e.g. H1 → H3)', 'Use headings in order (H1 → H2 → H3) so the outline is clear to screen readers and crawlers; style with CSS, not heading level.', {
          url: p.url,
          detail: `H${prev.level} → H${cur.level} at ${quote(cur.text, 50)}`,
        })
        break
      }
    }
    if (p.images_missing_alt.length > 0) {
      issues.add('images-missing-alt', 'warning', 'Images without an alt attribute', 'Add alt text describing each informative image; use alt="" for purely decorative ones.', {
        url: p.url,
        detail: `${p.images_missing_alt.length} of ${p.images_total} images, e.g. ${p.images_missing_alt.slice(0, 2).join(', ')}`,
      })
    }
  }

  // ---- performance ------------------------------------------------------
  for (const p of crawl.pages) {
    if (p.response_ms !== null && p.response_ms > t.slow_ms && (p.status_kind === 'ok' || p.status_kind === 'redirect')) {
      issues.add('slow-response', 'warning', `Slow server response (over ${t.slow_ms} ms)`, 'Cache the page at the edge/CDN, add server-side caching, or optimise the slow backend query; aim for under 600 ms TTFB.', {
        url: p.url,
        detail: `${p.response_ms} ms`,
      })
    }
  }

  // ---- indexing directives ----------------------------------------------
  for (const p of content) {
    const distinct = [...new Set(p.canonicals)]
    if (distinct.length > 1) {
      issues.add('canonical-conflict', 'error', 'Conflicting or broken canonicals', 'Declare exactly one canonical, pointing at a live (200), indexable URL.', {
        url: p.url,
        detail: `${distinct.length} different canonicals: ${distinct.join(', ')}`,
      })
      continue
    }
    const canonical = distinct[0]
    if (!canonical || canonical === p.url) {
      if (canonical && p.noindex) {
        issues.add('canonical-conflict', 'error', 'Conflicting or broken canonicals', 'Declare exactly one canonical, pointing at a live (200), indexable URL.', {
          url: p.url,
          detail: 'self-canonical page is also noindex',
        })
      }
      continue
    }
    const target = byUrl.get(canonical)
    if (target && (target.status_kind !== 'ok' || target.noindex)) {
      const why = target.noindex ? 'is noindex' : target.status_kind === 'redirect' ? `redirects to ${target.final_url}` : `returns HTTP ${target.status ?? target.status_kind}`
      issues.add('canonical-conflict', 'error', 'Conflicting or broken canonicals', 'Declare exactly one canonical, pointing at a live (200), indexable URL.', {
        url: p.url,
        detail: `canonical ${canonical} ${why}`,
      })
    } else {
      issues.add('canonicalized-page', 'notice', 'Pages canonicalised to another URL', 'Expected for variants. If this page should rank on its own, make it self-canonical; otherwise remove it from the sitemap and link to the canonical instead.', {
        url: p.url,
        detail: `→ ${canonical}${p.in_sitemap ? ' (still listed in the sitemap)' : ''}`,
      })
    }
  }
  for (const p of content) {
    if (p.noindex) {
      issues.add('noindex-page', p.in_sitemap ? 'warning' : 'notice', 'Pages marked noindex', 'Intentional for utility pages. If the page should rank, remove the noindex (meta robots / X-Robots-Tag); if not, remove it from the sitemap.', {
        url: p.url,
        detail: `${p.robots_meta ?? p.x_robots_tag ?? 'noindex'}${p.in_sitemap ? ' — listed in the sitemap' : ''}`,
      })
    }
  }

  // ---- crawl coverage notices -------------------------------------------
  const blocked = crawl.pages.filter((p) => p.status_kind === 'blocked_robots')
  if (blocked.length) {
    for (const p of blocked) {
      issues.add('blocked-by-robots', 'notice', 'Linked URLs blocked by robots.txt (not checked)', 'Expected for private areas. If any of these should rank, allow them in robots.txt; otherwise avoid linking to them prominently.', { url: p.url })
    }
  }
  const limited = crawl.pages.filter((p) => p.status_kind === 'rate_limited')
  for (const p of limited) {
    issues.add('rate-limited', 'warning', 'URLs the server rate-limited (not checked, not reported as broken)', 'Re-run with lower concurrency (concurrency: 1) and a page budget, or allowlist the audit user agent in the WAF/CDN.', {
      url: p.url,
      detail: `HTTP ${p.status ?? 429} after retries`,
    })
  }
  if (crawl.page_limit_reached) {
    issues.notice('crawl-page-limit', 'Crawl stopped at the page budget', 'Raise max_pages, or exclude low-value sections (exclude_paths) to audit the rest.', `Stopped after ${crawl.pages.length} pages; about ${crawl.unvisited} discovered URLs were not visited, so site-wide checks (orphans, duplicates, depth) are partial.`)
  }
  if (crawl.time_limit_reached) {
    issues.notice('crawl-time-limit', 'Crawl stopped at the time limit', 'Raise max_duration_s, increase concurrency if the server allows it, or narrow the crawl with exclude_paths.', `Stopped after ${Math.round(crawl.duration_ms / 1000)} s with ${crawl.pages.length} pages; about ${crawl.unvisited} discovered URLs were not visited.`)
  }
  return issues.list()
}

export interface AuditSummary {
  pages_crawled: number
  content_pages: number
  indexable_pages: number
  by_status: Record<string, number>
  issues: { error: number; warning: number; notice: number }
  issue_types: number
  /** 0–100: share of content pages without any error or warning. */
  health_score: number | null
}

export function summarize(crawl: CrawlResult, issues: SiteIssue[]): AuditSummary {
  const byStatus: Record<string, number> = {}
  for (const p of crawl.pages) byStatus[p.status_kind] = (byStatus[p.status_kind] ?? 0) + 1
  const counts = { error: 0, warning: 0, notice: 0 }
  const badPages = new Set<string>()
  for (const i of issues) {
    counts[i.severity] += i.count
    if (i.severity !== 'notice') for (const p of i.pages) if (p.url) badPages.add(p.url)
  }
  const content = crawl.pages.filter(isContentPage)
  const clean = content.filter((p) => !badPages.has(p.url)).length
  return {
    pages_crawled: crawl.pages.length,
    content_pages: content.length,
    indexable_pages: content.filter(isIndexable).length,
    by_status: byStatus,
    issues: counts,
    issue_types: issues.length,
    health_score: content.length ? Math.round((100 * clean) / content.length) : null,
  }
}
