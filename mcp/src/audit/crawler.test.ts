import { describe, it, expect } from 'vitest'
import { crawlSite, normalizeUrl, robotsPatternMatches, extractHtml, simhash, hammingHex, words, type CrawlOptions } from './crawler.js'
import { analyzeSite, summarize } from './site-issues.js'
import { fakeFetcher } from './__fixtures__/fake-site.js'

const OPTS: CrawlOptions = {
  startUrl: 'https://example.com/',
  maxPages: 100,
  maxDurationMs: 60_000,
  concurrency: 3,
  delayMs: 0,
  excludePaths: [],
  includeSitemap: true,
  renderJs: false,
  userAgent: 'ga4-manager-audit/test',
}

const noSleep = async (): Promise<void> => {}

describe('URL helpers', () => {
  it('normalizes and drops tracking params and fragments', () => {
    expect(normalizeUrl('/a?utm_source=x&b=1#top', 'https://Example.com/')).toBe('https://example.com/a?b=1')
    expect(normalizeUrl('mailto:x@example.com')).toBeNull()
    expect(normalizeUrl('https://example.com:443/')).toBe('https://example.com/')
  })
  it.each([
    ['/tag/', '/tag/x', true],
    ['/tag/', '/tags', false],
    ['/*?sort=', '/shop?sort=price', true],
    ['/*.pdf$', '/a/b.pdf', true],
    ['/*.pdf$', '/a/b.pdf?x', false],
  ])('pattern %s vs %s', (pattern, path, want) => expect(robotsPatternMatches(pattern, path)).toBe(want))
})

describe('extractHtml', () => {
  it('reads title, description, canonicals, headings, alt and links, ignoring script text', () => {
    const x = extractHtml(
      `<html><head><title>T &amp; U</title><meta name="description" content="D"><link rel="canonical" href="/c">
       <meta name="robots" content="noindex"></head><body><h1>A</h1><h3>B</h3><img src="x.png"><img src="y.png" alt="">
       <a href="/p#frag">p</a><a href="tel:1">t</a><script>one two three four</script><p>hello world</p></body></html>`,
      'https://example.com/page',
    )
    expect(x).toMatchObject({
      title: 'T & U',
      meta_description: 'D',
      canonicals: ['https://example.com/c'],
      robots_meta: 'noindex',
      h1: ['A'],
      headings: [{ level: 1, text: 'A' }, { level: 3, text: 'B' }],
      images_total: 2,
      images_missing_alt: ['x.png'],
      links: ['https://example.com/p'],
    })
    expect(x.word_count).toBe(6) // A, B, p, t (link text), hello, world — not the script
  })
  it('simhash puts near-duplicates within a few bits', () => {
    const a = simhash(words('the quick brown fox jumps over the lazy dog '.repeat(20)))!
    const b = simhash(words('the quick brown fox jumps over the lazy dog '.repeat(20) + 'extra'))!
    const c = simhash(words('completely different text about other subjects entirely '.repeat(20)))!
    expect(hammingHex(a, b)).toBeLessThanOrEqual(3)
    expect(hammingHex(a, c)).toBeGreaterThan(10)
  })
})

describe('crawlSite on the fixture site', () => {
  it('crawls same-origin pages, honours robots and records statuses', async () => {
    const { fetch, calls } = fakeFetcher()
    const res = await crawlSite(OPTS, { fetch, sleep: noSleep })
    const by = new Map(res.pages.map((p) => [p.url, p]))
    expect(res.robots).toMatchObject({ found: true, sitemaps: ['https://example.com/sitemap.xml'] })
    expect(res.sitemap_urls).toBe(4)
    expect(by.get('https://example.com/private/x')?.status_kind).toBe('blocked_robots')
    expect(calls).not.toContain('https://example.com/private/x')
    expect(calls.some((c) => c.startsWith('https://external.example'))).toBe(false)
    expect(by.get('https://example.com/blog')).toBeDefined() // utm stripped
    expect(by.get('https://example.com/broken')).toMatchObject({ status: 404, status_kind: 'client_error', inlinks: 1 })
    expect(by.get('https://example.com/old')).toMatchObject({ status_kind: 'redirect', final_url: 'https://example.com/about' })
    expect(by.get('https://example.com/old')!.redirect_chain).toHaveLength(2)
    expect(by.get('https://example.com/loop1')).toMatchObject({ redirect_loop: true })
    expect(by.get('https://example.com/throttled')).toMatchObject({ status_kind: 'rate_limited' })
    expect(by.get('https://example.com/file.pdf')).toMatchObject({ status_kind: 'non_html' })
    expect(by.get('https://example.com/orphan')).toMatchObject({ found_via: 'sitemap', inlinks: 0, depth: null, in_sitemap: true })
    expect(by.get('https://example.com/blog/a/b/c/d')!.depth).toBe(5)
    expect(by.get('https://example.com/')!.depth).toBe(0)
    expect(res.rate_limited_hits).toBeGreaterThan(0)
  })

  it('stops at the page budget and says how much was left', async () => {
    const { fetch } = fakeFetcher()
    const res = await crawlSite({ ...OPTS, maxPages: 5, concurrency: 1 }, { fetch, sleep: noSleep })
    expect(res.pages.filter((p) => p.status_kind !== 'blocked_robots')).toHaveLength(5)
    expect(res.page_limit_reached).toBe(true)
    expect(res.unvisited).toBeGreaterThan(0)
  })

  it('stops at the time budget', async () => {
    const { fetch } = fakeFetcher()
    let t = 0
    const res = await crawlSite({ ...OPTS, maxDurationMs: 50, concurrency: 1 }, { fetch, sleep: noSleep, now: () => (t += 20) })
    expect(res.time_limit_reached).toBe(true)
  })

  it('skips excluded paths without fetching them', async () => {
    const { fetch, calls } = fakeFetcher()
    const res = await crawlSite({ ...OPTS, excludePaths: ['/blog'] }, { fetch, sleep: noSleep })
    expect(calls.some((c) => c.includes('/blog'))).toBe(false)
    expect(res.excluded).toBeGreaterThan(0)
  })

  it('follows a start redirect and treats both hosts as internal', async () => {
    const { fetch } = fakeFetcher({
      'https://www.example.com/': { status: 301, headers: { location: 'https://example.com/' } },
      'https://example.com/': { status: 200, body: '<html><head><title>x</title></head><body><a href="https://www.example.com/a">a</a></body></html>' },
      'https://www.example.com/a': { status: 301, headers: { location: 'https://example.com/a' } },
      'https://example.com/a': { status: 200, body: '<html><body>a</body></html>' },
    })
    const res = await crawlSite({ ...OPTS, startUrl: 'https://www.example.com/', includeSitemap: false }, { fetch, sleep: noSleep })
    expect(res.final_start_url).toBe('https://example.com/')
    expect(res.pages.map((p) => p.url).sort()).toEqual(['https://example.com/', 'https://example.com/a', 'https://www.example.com/a'])
  })

  it('uses the renderer when render_js is on and falls back on failure', async () => {
    const { fetch } = fakeFetcher({
      'https://example.com/': { status: 200, body: '<html><body><div id="app"></div></body></html>' },
      'https://example.com/x': { status: 200, body: '<html><body>x</body></html>' },
    })
    const render = async (url: string): Promise<string> => {
      if (url.endsWith('/x')) throw new Error('boom')
      return '<html><head><title>Rendered</title></head><body><a href="/x">x</a></body></html>'
    }
    const res = await crawlSite({ ...OPTS, includeSitemap: false, renderJs: true }, { fetch, render, sleep: noSleep })
    const home = res.pages.find((p) => p.url === 'https://example.com/')!
    expect(home).toMatchObject({ rendered: true, title: 'Rendered' })
    expect(res.pages.find((p) => p.url === 'https://example.com/x')!.error).toMatch(/render failed/)
  })
})

describe('analyzeSite on the fixture site', () => {
  it('finds one of each issue type with how_to_fix', async () => {
    const { fetch } = fakeFetcher()
    const crawl = await crawlSite(OPTS, { fetch, sleep: noSleep })
    const issues = analyzeSite(crawl)
    const types = new Map(issues.map((i) => [i.type, i]))
    for (const t of [
      'broken-internal-link', 'orphan-page', 'deep-page', 'redirect-chain', 'redirect-loop', 'duplicate-title',
      'duplicate-content', 'thin-content', 'heading-order-skip', 'images-missing-alt', 'slow-response', 'canonical-conflict',
      'canonicalized-page', 'noindex-page', 'title-too-short', 'blocked-by-robots', 'rate-limited', 'internal-link-to-redirect',
    ]) {
      expect(types.has(t), t).toBe(true)
      expect(types.get(t)!.how_to_fix.length, t).toBeGreaterThan(20)
    }
    expect(types.get('broken-internal-link')!.pages.map((p) => p.url)).toContain('https://example.com/broken')
    expect(types.get('orphan-page')!.pages.map((p) => p.url)).toEqual(['https://example.com/orphan'])
    expect(types.get('noindex-page')!.severity).toBe('warning') // listed in the sitemap
    expect(types.get('canonical-conflict')!.pages.map((p) => p.url).sort()).toEqual(['https://example.com/canon', 'https://example.com/two-canon'])
    expect(types.get('duplicate-title')!.pages.map((p) => p.url).sort()).toEqual(['https://example.com/about', 'https://example.com/about-copy'])
    expect(types.has('crawl-page-limit')).toBe(false)
    // Rate-limited and blocked URLs are never reported as broken.
    expect(types.get('broken-internal-link')!.pages.some((p) => p.url.includes('throttled') || p.url.includes('private'))).toBe(false)
    // Sorted by severity.
    const order = issues.map((i) => i.severity)
    expect(order.indexOf('error')).toBeLessThan(order.lastIndexOf('notice'))

    const summary = summarize(crawl, issues)
    expect(summary.by_status.blocked_robots).toBe(1)
    expect(summary.health_score).toBeGreaterThanOrEqual(0)
  })

  it('adds the page-limit notice when the budget cut the crawl', async () => {
    const { fetch } = fakeFetcher()
    const crawl = await crawlSite({ ...OPTS, maxPages: 3, concurrency: 1 }, { fetch, sleep: noSleep })
    const issue = analyzeSite(crawl).find((i) => i.type === 'crawl-page-limit')
    expect(issue?.severity).toBe('notice')
    expect(issue?.pages[0].detail).toMatch(/not visited/)
  })
})

describe('content text', () => {
  it('ignores highlighting markup inside <pre> and shared chrome outside <main>', () => {
    const page = (body: string): string =>
      `<html><body><nav>${'menu item '.repeat(200)}</nav><main><p>${body}</p><pre><span class="line"><span style="color:#fff">const</span> x</span></pre></main><footer>${'footer link '.repeat(200)}</footer></body></html>`
    const a = extractHtml(page('alpha beta gamma delta '.repeat(30)), 'https://example.com/a')
    const b = extractHtml(page('one two three four five six '.repeat(30)), 'https://example.com/b')
    expect(a.word_count).toBe(122) // 120 body words + "const x", no nav/footer, no "span"/"class"
    expect(hammingHex(a.simhash!, b.simhash!)).toBeGreaterThan(10)
  })
})

describe('httpFetcher', () => {
  it('reads text/plain bodies (robots.txt) but not binary ones', async () => {
    const { httpFetcher } = await import('./crawler.js')
    const { vi } = await import('vitest')
    const spy = vi.spyOn(global, 'fetch')
    spy.mockResolvedValueOnce(new Response('User-agent: *\nDisallow:', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    expect((await httpFetcher('https://example.com/robots.txt', { userAgent: 'x', readBody: true })).body).toContain('User-agent')
    spy.mockResolvedValueOnce(new Response('PK', { status: 200, headers: { 'content-type': 'application/zip' } }))
    expect((await httpFetcher('https://example.com/a.zip', { userAgent: 'x', readBody: true })).body).toBeNull()
    spy.mockRestore()
  })
})

describe('crawl budget (B7)', () => {
  it('does not spend the page budget on robots-blocked URLs', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/go/app?src=${i}">x</a>`).join('') + '<a href="/a">a</a><a href="/b">b</a>'
    const { fetch, calls } = fakeFetcher({
      'https://example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /go/\n' },
      'https://example.com/': { status: 200, body: `<html><body>${links}</body></html>` },
      'https://example.com/a': { status: 200, body: '<html><body>a</body></html>' },
      'https://example.com/b': { status: 200, body: '<html><body>b</body></html>' },
    })
    const res = await crawlSite({ ...OPTS, maxPages: 3, includeSitemap: false, concurrency: 1 }, { fetch, sleep: noSleep })
    const fetched = res.pages.filter((p) => p.status_kind !== 'blocked_robots').map((p) => p.url).sort()
    expect(fetched).toEqual(['https://example.com/', 'https://example.com/a', 'https://example.com/b'])
    expect(res.pages.filter((p) => p.status_kind === 'blocked_robots')).toHaveLength(20)
    expect(calls.some((c) => c.includes('/go/'))).toBe(false)
    expect(res.page_limit_reached).toBe(false)
  })
})
