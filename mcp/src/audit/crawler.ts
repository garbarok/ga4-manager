import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { parse, type HTMLElement } from 'node-html-parser'
import { decodeEntities } from '../tools/html-signals.js'

const require = createRequire(import.meta.url)
// robots-parser is CJS-only (see utils/robots-check.ts).
const robotsParser = require('robots-parser') as (
  url: string,
  content: string,
) => { isAllowed(url: string, ua?: string): boolean | undefined; getSitemaps(): string[]; getCrawlDelay(ua?: string): number | undefined }

/**
 * Same-origin site crawler for site_audit_run.
 *
 * - Breadth-first from a start URL, plus URLs listed in the site's sitemaps
 *   (so orphan pages can be found), until `maxPages` or `maxDurationMs`.
 * - robots.txt is honoured for our user agent; blocked URLs are recorded as
 *   `blocked_robots`, never fetched, never reported as broken.
 * - `excludePaths` uses robots-style patterns (`*` wildcard, `$` end anchor).
 * - HTTP 429 (and 503 with Retry-After) back off, honouring Retry-After, and
 *   slow the whole crawl down; a URL that stays throttled is `rate_limited`,
 *   not a broken page.
 * - Redirects are followed by hand so chains and loops are recorded.
 * - Optional JS rendering swaps the fetched HTML for a rendered DOM.
 *
 * I/O is injected (fetcher, renderer, clock, sleep), so tests run on fixtures.
 */

export type StatusKind =
  | 'ok'
  | 'redirect'
  | 'client_error'
  | 'server_error'
  | 'blocked_robots'
  | 'rate_limited'
  | 'fetch_error'
  | 'non_html'

export interface Heading {
  level: number
  text: string
}

export interface CrawledPage {
  url: string
  final_url: string
  status: number | null
  status_kind: StatusKind
  redirect_chain: { url: string; status: number }[]
  redirect_loop: boolean
  /** Shortest click path from the start URL; null when only found in a sitemap. */
  depth: number | null
  found_via: 'link' | 'sitemap' | 'start'
  in_sitemap: boolean
  content_type: string | null
  /** Time to response headers (ms). */
  response_ms: number | null
  bytes: number | null
  rendered: boolean
  title: string | null
  meta_description: string | null
  canonicals: string[]
  robots_meta: string | null
  x_robots_tag: string | null
  noindex: boolean
  h1: string[]
  headings: Heading[]
  word_count: number
  content_hash: string | null
  simhash: string | null
  images_total: number
  images_missing_alt: string[]
  internal_links: string[]
  external_links: number
  inlinks: number
  error?: string
}

export interface FetchResponse {
  status: number
  headers: Record<string, string>
  /** Null when the body was not read (redirect, non-HTML, error status without body). */
  body: string | null
  elapsedMs: number
}

export type Fetcher = (url: string, opts: { userAgent: string; readBody: boolean }) => Promise<FetchResponse>

export interface CrawlOptions {
  startUrl: string
  maxPages: number
  maxDurationMs: number
  concurrency: number
  /** Pause between requests per worker. */
  delayMs: number
  excludePaths: string[]
  includeSitemap: boolean
  renderJs: boolean
  userAgent: string
  maxRedirects?: number
  maxRetries?: number
}

export interface CrawlProgress {
  pages_crawled: number
  queued: number
  current_url: string | null
  rate_limited_hits: number
}

export interface CrawlDeps {
  fetch: Fetcher
  render?: (url: string) => Promise<string>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  onProgress?: (p: CrawlProgress) => void
  shouldStop?: () => boolean
}

export interface CrawlResult {
  start_url: string
  final_start_url: string
  pages: CrawledPage[]
  robots: { found: boolean; sitemaps: string[]; crawl_delay_s: number | null }
  sitemap_urls: number
  page_limit_reached: boolean
  time_limit_reached: boolean
  stopped: boolean
  /** Internal URLs discovered but not fetched because of the page or time budget. */
  unvisited: number
  excluded: number
  rate_limited_hits: number
  duration_ms: number
}

// ============================================================================
// URL helpers
// ============================================================================

const TRACKING_PARAM = /^(utm_[a-z]+|gclid|fbclid|mc_cid|mc_eid|msclkid)$/i

/** Absolute http(s) URL without fragment or tracking parameters, host lowercased. Null when not crawlable. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim(), base)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key)
  u.hostname = u.hostname.toLowerCase()
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
  return u.toString()
}

/**
 * Robots-style path pattern: `*` matches any run of characters, a trailing `$`
 * anchors the end; otherwise it is a prefix match against path + query.
 */
export function robotsPatternMatches(pattern: string, pathAndQuery: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  const anchored = p.endsWith('$')
  const body = anchored ? p.slice(0, -1) : p
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
  return re.test(pathAndQuery)
}

function pathAndQuery(url: string): string {
  const u = new URL(url)
  return u.pathname + u.search
}

// ============================================================================
// HTML extraction
// ============================================================================

const SKIP_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe'])

function textOf(el: HTMLElement): string {
  return decodeEntities(el.text).replace(/\s+/g, ' ').trim()
}

/**
 * Text a reader sees in the page's main content: <main>, else a single
 * <article>, else <body>, without script/style/svg. Scoping to the main
 * content keeps shared navigation and footers from making pages look alike.
 */
function visibleText(root: HTMLElement): string {
  const articles = root.querySelectorAll('article')
  const body = root.querySelector('main') ?? (articles.length === 1 ? articles[0] : null) ?? root.querySelector('body') ?? root
  const parts: string[] = []
  const walk = (node: HTMLElement): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) parts.push(child.rawText)
      else if (child.nodeType === 1) {
        const el = child as HTMLElement
        if (!SKIP_TEXT_TAGS.has(el.rawTagName?.toLowerCase())) walk(el)
      }
    }
  }
  walk(body)
  return decodeEntities(parts.join(' ')).replace(/\s+/g, ' ').trim()
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function fnv64(s: string): bigint {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h
}

/** 64-bit simhash over word 3-shingles, hex. Near-duplicate pages differ in few bits. */
export function simhash(tokens: string[]): string | null {
  if (tokens.length < 3) return null
  const v = new Array<number>(64).fill(0)
  for (let i = 0; i + 2 < tokens.length; i++) {
    const h = fnv64(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1
  }
  let out = 0n
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b)
  return out.toString(16).padStart(16, '0')
}

export function hammingHex(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

export interface ExtractedHtml {
  title: string | null
  meta_description: string | null
  canonicals: string[]
  robots_meta: string | null
  h1: string[]
  headings: Heading[]
  word_count: number
  content_hash: string | null
  simhash: string | null
  images_total: number
  images_missing_alt: string[]
  links: string[]
}

export function extractHtml(html: string, pageUrl: string): ExtractedHtml {
  // <pre> is parsed, not kept raw: highlighted code is markup (<span class=…>) whose tag text must not count as words.
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true } })
  const baseHref = root.querySelector('base[href]')?.getAttribute('href')
  const base = (baseHref && normalizeUrl(baseHref, pageUrl)) || pageUrl

  const titleEl = root.querySelector('title')
  const title = titleEl ? textOf(titleEl) || null : null
  let description: string | null = null
  let robotsMeta: string | null = null
  for (const meta of root.querySelectorAll('meta')) {
    const name = (meta.getAttribute('name') ?? '').toLowerCase()
    const content = meta.getAttribute('content')
    if (content === undefined) continue
    if (name === 'description' && description === null) description = decodeEntities(content).replace(/\s+/g, ' ').trim()
    if ((name === 'robots' || name === 'googlebot') && content.trim()) robotsMeta = robotsMeta ? `${robotsMeta}, ${content.trim()}` : content.trim()
  }
  const canonicals = root
    .querySelectorAll('link')
    .filter((l) => (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((l) => normalizeUrl(l.getAttribute('href') ?? '', base))
    .filter((u): u is string => u !== null)

  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6').map((h) => ({ level: Number(h.rawTagName.slice(1)), text: textOf(h).slice(0, 200) }))
  const imgs = root.querySelectorAll('img')
  const missingAlt = imgs.filter((img) => img.getAttribute('alt') === undefined).map((img) => img.getAttribute('src') ?? img.getAttribute('data-src') ?? '(no src)')

  const links = new Set<string>()
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (/^\s*(mailto|tel|javascript|data|sms|ftp):/i.test(href)) continue
    const u = normalizeUrl(href, base)
    if (u) links.add(u)
  }

  const text = visibleText(root)
  const tokens = words(text)
  return {
    title,
    meta_description: description || null,
    canonicals: [...new Set(canonicals)],
    robots_meta: robotsMeta,
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    headings,
    word_count: tokens.length,
    content_hash: tokens.length ? createHash('sha1').update(tokens.join(' ')).digest('hex') : null,
    simhash: simhash(tokens),
    images_total: imgs.length,
    images_missing_alt: missingAlt.slice(0, 50),
    links: [...links],
  }
}

// ============================================================================
// Default fetcher (node fetch, manual redirects)
// ============================================================================

const MAX_BODY_BYTES = 5 * 1024 * 1024

export const httpFetcher: Fetcher = async (url, { userAgent, readBody }) => {
  const started = Date.now()
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(20_000),
  })
  const elapsedMs = Date.now() - started
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
  const type = headers['content-type'] ?? ''
  // HTML pages, plus the text formats the crawl itself reads (robots.txt, sitemaps).
  const readable = /html|xml|text\/plain/i.test(type) || type === ''
  let body: string | null = null
  if (readBody && readable && res.status < 300) {
    const len = Number(headers['content-length'] ?? 0)
    if (len > MAX_BODY_BYTES) await res.body?.cancel()
    else body = (await res.text()).slice(0, MAX_BODY_BYTES)
  } else {
    await res.body?.cancel().catch(() => undefined)
  }
  return { status: res.status, headers, body, elapsedMs }
}

// ============================================================================
// Crawl
// ============================================================================

function emptyPage(url: string, foundVia: CrawledPage['found_via'], depth: number | null): CrawledPage {
  return {
    url, final_url: url, status: null, status_kind: 'fetch_error', redirect_chain: [], redirect_loop: false,
    depth, found_via: foundVia, in_sitemap: false, content_type: null, response_ms: null, bytes: null, rendered: false,
    title: null, meta_description: null, canonicals: [], robots_meta: null, x_robots_tag: null, noindex: false,
    h1: [], headings: [], word_count: 0, content_hash: null, simhash: null, images_total: 0, images_missing_alt: [],
    internal_links: [], external_links: 0, inlinks: 0,
  }
}

function statusKind(status: number): StatusKind {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'redirect'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'client_error'
  return 'server_error'
}

function retryAfterMs(headers: Record<string, string>, attempt: number, now: number): number {
  const ra = headers['retry-after']
  if (ra) {
    const secs = Number(ra)
    if (Number.isFinite(secs)) return Math.min(60_000, Math.max(0, secs * 1000))
    const at = Date.parse(ra)
    if (Number.isFinite(at)) return Math.min(60_000, Math.max(0, at - now))
  }
  return Math.min(60_000, 1000 * 2 ** attempt)
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]))
}

export async function crawlSite(opts: CrawlOptions, deps: CrawlDeps): Promise<CrawlResult> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const started = now()
  const maxRedirects = opts.maxRedirects ?? 10
  const maxRetries = opts.maxRetries ?? 3
  const ua = opts.userAgent

  const start = normalizeUrl(opts.startUrl)
  if (!start) throw new Error(`Start URL "${opts.startUrl}" is not an absolute http(s) URL.`)
  const internalHosts = new Set([new URL(start).hostname])
  const isInternal = (u: string): boolean => {
    const h = new URL(u).hostname
    return internalHosts.has(h)
  }

  let delayMs = opts.delayMs
  let limit = Math.max(1, opts.concurrency)
  let rateLimitedHits = 0

  async function fetchWithBackoff(url: string, readBody: boolean): Promise<FetchResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await deps.fetch(url, { userAgent: ua, readBody })
      const throttled = res.status === 429 || (res.status === 503 && res.headers['retry-after'] !== undefined)
      if (!throttled || attempt >= maxRetries) return res
      rateLimitedHits += 1
      // Slow the whole crawl down: one worker, at least a second between requests.
      limit = 1
      delayMs = Math.max(delayMs * 2, 1000)
      await sleep(retryAfterMs(res.headers, attempt, now()))
    }
  }

  // ---- start URL redirect resolution (http → https, apex → www) ----------
  let finalStart = start
  try {
    let cur = start
    for (let i = 0; i < maxRedirects; i++) {
      const r = await fetchWithBackoff(cur, false)
      const loc = r.status >= 300 && r.status < 400 ? r.headers.location : undefined
      if (!loc) break
      const next = normalizeUrl(loc, cur)
      if (!next || next === cur) break
      internalHosts.add(new URL(next).hostname)
      cur = next
    }
    finalStart = cur
  } catch {
    // The start URL itself failing is recorded when it is crawled below.
  }
  const origin = new URL(finalStart).origin

  // ---- robots.txt ---------------------------------------------------------
  let robots: ReturnType<typeof robotsParser> | null = null
  let robotsFound = false
  try {
    const r = await fetchWithBackoff(`${origin}/robots.txt`, true)
    if (r.status === 200 && r.body !== null) {
      robots = robotsParser(`${origin}/robots.txt`, r.body)
      robotsFound = true
    }
  } catch {
    robots = null
  }
  const uaToken = ua.split('/')[0]
  const allowed = (u: string): boolean => !robots || robots.isAllowed(u, uaToken) !== false
  const crawlDelay = robots?.getCrawlDelay(uaToken) ?? null
  if (crawlDelay && crawlDelay * 1000 > delayMs) delayMs = Math.min(crawlDelay * 1000, 10_000)
  const robotSitemaps = robots?.getSitemaps() ?? []

  // ---- sitemaps -----------------------------------------------------------
  const sitemapUrls = new Set<string>()
  if (opts.includeSitemap) {
    const toRead = robotSitemaps.length ? [...robotSitemaps] : [`${origin}/sitemap.xml`]
    const seenMaps = new Set<string>()
    while (toRead.length && seenMaps.size < 50 && sitemapUrls.size < 50_000) {
      const map = toRead.shift()!
      if (seenMaps.has(map)) continue
      seenMaps.add(map)
      try {
        const r = await fetchWithBackoff(map, true)
        if (r.status !== 200 || !r.body) continue
        const locs = extractLocs(r.body)
        if (/<sitemapindex/i.test(r.body)) toRead.push(...locs)
        else for (const l of locs) {
          const n = normalizeUrl(l)
          if (n && isInternal(n)) sitemapUrls.add(n)
        }
      } catch {
        // unreadable sitemap: skip
      }
    }
  }

  // ---- crawl --------------------------------------------------------------
  const pages = new Map<string, CrawledPage>()
  const queued = new Set<string>()
  const queue: { url: string; via: CrawledPage['found_via']; depth: number | null }[] = []
  let excluded = 0
  const isExcluded = (u: string): boolean => opts.excludePaths.some((p) => robotsPatternMatches(p, pathAndQuery(u)))

  const enqueue = (url: string, via: CrawledPage['found_via'], depth: number | null): void => {
    if (queued.has(url)) return
    queued.add(url)
    if (isExcluded(url)) {
      excluded += 1
      return
    }
    queue.push({ url, via, depth })
  }
  enqueue(finalStart, 'start', 0)
  // Sitemap URLs go after link discovery: they only matter if links never reach them.
  const sitemapQueue = [...sitemapUrls]

  let pageLimit = false
  let timeLimit = false
  let stopped = false

  const crawlOne = async (item: { url: string; via: CrawledPage['found_via']; depth: number | null }): Promise<void> => {
    const page = emptyPage(item.url, item.via, item.depth)
    pages.set(item.url, page)
    if (!allowed(item.url)) {
      page.status_kind = 'blocked_robots'
      return
    }
    try {
      let cur = item.url
      const seen = new Set<string>([cur])
      let res: FetchResponse | null = null
      for (let hop = 0; hop <= maxRedirects; hop++) {
        res = await fetchWithBackoff(cur, true)
        if (hop === 0) page.response_ms = res.elapsedMs
        const loc = res.status >= 300 && res.status < 400 ? res.headers.location : undefined
        if (!loc) break
        const next = normalizeUrl(loc, cur)
        page.redirect_chain.push({ url: cur, status: res.status })
        if (!next) break
        if (seen.has(next)) {
          page.redirect_loop = true
          break
        }
        seen.add(next)
        cur = next
        if (!isInternal(cur) || !allowed(cur)) {
          res = { status: 0, headers: {}, body: null, elapsedMs: 0 }
          break
        }
      }
      page.final_url = cur
      if (!res) return
      if (page.redirect_chain.length > 0) {
        // A redirecting URL is reported as a redirect; its target is crawled as its own page.
        page.status = page.redirect_chain[0].status
        page.status_kind = 'redirect'
        if (!page.redirect_loop && res.status !== 0) enqueue(cur, item.via, item.depth)
        return
      }
      page.status = res.status
      page.status_kind = statusKind(res.status)
      page.content_type = res.headers['content-type'] ?? null
      page.x_robots_tag = res.headers['x-robots-tag'] ?? null
      if (res.status >= 300) return
      if (page.content_type && !/html/i.test(page.content_type)) {
        page.status_kind = 'non_html'
        return
      }
      let html = res.body ?? ''
      page.bytes = Buffer.byteLength(html)
      if (opts.renderJs && deps.render) {
        try {
          html = await deps.render(cur)
          page.rendered = true
        } catch (err) {
          page.error = `render failed, used raw HTML: ${(err as Error).message}`
        }
      }
      const x = extractHtml(html, cur)
      Object.assign(page, {
        title: x.title,
        meta_description: x.meta_description,
        canonicals: x.canonicals,
        robots_meta: x.robots_meta,
        h1: x.h1,
        headings: x.headings,
        word_count: x.word_count,
        content_hash: x.content_hash,
        simhash: x.simhash,
        images_total: x.images_total,
        images_missing_alt: x.images_missing_alt,
      })
      page.noindex = /noindex/i.test(`${x.robots_meta ?? ''} ${page.x_robots_tag ?? ''}`)
      const internal = x.links.filter(isInternal)
      page.internal_links = internal
      page.external_links = x.links.length - internal.length
      // Links from a redirecting URL are discovered from its final page, at that page's depth.
      const childDepth = item.depth === null ? null : item.depth + 1
      for (const l of internal) enqueue(l, 'link', childDepth)
    } catch (err) {
      page.status_kind = 'fetch_error'
      page.error = err instanceof Error ? err.message : String(err)
    }
  }

  const inFlight = new Set<Promise<void>>()
  const report = (current: string | null): void =>
    deps.onProgress?.({ pages_crawled: pages.size, queued: queue.length + sitemapQueue.length, current_url: current, rate_limited_hits: rateLimitedHits })

  while (true) {
    if (deps.shouldStop?.()) {
      stopped = true
      break
    }
    if (now() - started >= opts.maxDurationMs) {
      timeLimit = true
      break
    }
    if (queue.length === 0 && inFlight.size === 0) {
      // Links exhausted: fall back to sitemap-only URLs.
      while (sitemapQueue.length && queue.length === 0) {
        const u = sitemapQueue.shift()!
        if (!queued.has(u)) enqueue(u, 'sitemap', null)
      }
      if (queue.length === 0) break
    }
    if (pages.size + inFlight.size >= opts.maxPages) {
      if (queue.length > 0 || sitemapQueue.some((u) => !queued.has(u))) pageLimit = true
      if (inFlight.size === 0) break
      await Promise.race(inFlight)
      continue
    }
    if (queue.length === 0 || inFlight.size >= limit) {
      await Promise.race(inFlight)
      continue
    }
    const item = queue.shift()!
    const p = crawlOne(item).then(async () => {
      if (delayMs > 0) await sleep(delayMs)
    })
    inFlight.add(p)
    void p.finally(() => {
      inFlight.delete(p)
      report(item.url)
    })
  }
  await Promise.all(inFlight)

  // ---- post-processing: sitemap flags, inlinks, true click depth ----------
  for (const page of pages.values()) page.in_sitemap = sitemapUrls.has(page.url) || sitemapUrls.has(page.final_url)
  const resolve = (u: string): string => pages.get(u)?.final_url ?? u
  const inlinkSources = new Map<string, Set<string>>()
  for (const page of pages.values()) {
    for (const l of page.internal_links) {
      if (l === page.url) continue
      const set = inlinkSources.get(l) ?? new Set<string>()
      set.add(page.url)
      inlinkSources.set(l, set)
    }
  }
  for (const page of pages.values()) page.inlinks = inlinkSources.get(page.url)?.size ?? 0

  // BFS over the link graph (redirects resolved) for exact click depth.
  const depth = new Map<string, number>([[finalStart, 0]])
  const bfs = [finalStart]
  while (bfs.length) {
    const u = bfs.shift()!
    const page = pages.get(u) ?? pages.get(resolve(u))
    if (!page) continue
    for (const l of page.internal_links) {
      for (const target of new Set([l, resolve(l)])) {
        if (!depth.has(target)) {
          depth.set(target, depth.get(u)! + 1)
          bfs.push(target)
        }
      }
    }
  }
  for (const page of pages.values()) page.depth = depth.get(page.url) ?? null

  const unvisited = [...queued].filter((u) => !pages.has(u) && !isExcluded(u)).length + sitemapQueue.filter((u) => !queued.has(u)).length
  return {
    start_url: start,
    final_start_url: finalStart,
    pages: [...pages.values()],
    robots: { found: robotsFound, sitemaps: robotSitemaps, crawl_delay_s: crawlDelay },
    sitemap_urls: sitemapUrls.size,
    page_limit_reached: pageLimit,
    time_limit_reached: timeLimit,
    stopped,
    unvisited,
    excluded,
    rate_limited_hits: rateLimitedHits,
    duration_ms: now() - started,
  }
}
