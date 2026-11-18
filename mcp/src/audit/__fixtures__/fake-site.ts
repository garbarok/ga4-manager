import type { Fetcher, FetchResponse } from '../crawler.js'

/**
 * An in-memory site with one example of each issue the audit detects.
 * No network; no personal or real-site data.
 */

const LOREM = (n: number, seed = 'alpha'): string =>
  Array.from({ length: n }, (_, i) => `${seed}${i % 37} word${(i * 7) % 53}`).join(' ')

function page(opts: {
  title?: string
  description?: string
  h?: string
  body?: string
  links?: string[]
  extraHead?: string
}): string {
  return `<!doctype html><html><head>
${opts.title !== undefined ? `<title>${opts.title}</title>` : ''}
${opts.description !== undefined ? `<meta name="description" content="${opts.description}">` : ''}
${opts.extraHead ?? ''}
</head><body>
${opts.h ?? '<h1>Heading</h1>'}
<p>${opts.body ?? LOREM(260)}</p>
${(opts.links ?? []).map((l) => `<a href="${l}">link</a>`).join('\n')}
<script>var notCounted = "lots of script words here"</script>
</body></html>`
}

const DESC = 'A description that is long enough to pass the minimum length check for meta descriptions on this page.'

export const SITE: Record<string, { status: number; headers?: Record<string, string>; body?: string; ms?: number }> = {
  'https://example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n' },
  'https://example.com/sitemap.xml': {
    status: 200,
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0"?><urlset>
      <url><loc>https://example.com/</loc></url>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/orphan</loc></url>
      <url><loc>https://example.com/noindexed</loc></url>
    </urlset>`,
  },
  'https://example.com/': {
    status: 200,
    body: page({
      title: 'Example home page with a helpful descriptive title',
      description: DESC,
      body: `${LOREM(300, 'home')} <img src="/a.png"> <img src="/b.png" alt="">`,
      links: ['/about', '/blog?utm_source=x', '/old', '/private/x', '/broken', 'https://external.example/', '/noindexed', '/slow', '/canon', '/variant', '/throttled', '/two-canon', 'mailto:hi@example.com', '/file.pdf'],
    }),
  },
  'https://example.com/about': {
    status: 200,
    body: page({ title: 'About us at Example, the company page title', description: DESC, body: LOREM(300, 'same'), links: ['/'] }),
  },
  'https://example.com/about-copy': {
    status: 200,
    body: page({ title: 'About us at Example, the company page title', description: 'Different description text that is long enough for the minimum check here.', body: LOREM(300, 'same'), links: ['/'] }),
  },
  'https://example.com/blog': {
    status: 200,
    body: page({ title: 'Blog', description: DESC + ' blog', h: '<h1>Blog</h1><h3>Skipped</h3>', body: 'short thin page', links: ['/blog/a', '/about-copy', '/loop1'] }),
  },
  'https://example.com/blog/a': { status: 200, body: page({ title: 'Post A with a reasonably long title here', description: DESC + ' a', body: LOREM(250, 'a'), links: ['/blog/a/b'] }) },
  'https://example.com/blog/a/b': { status: 200, body: page({ title: 'Post B with a reasonably long title here', description: DESC + ' b', body: LOREM(250, 'b'), links: ['/blog/a/b/c'] }) },
  'https://example.com/blog/a/b/c': { status: 200, body: page({ title: 'Post C with a reasonably long title here', description: DESC + ' c', body: LOREM(250, 'c'), links: ['/blog/a/b/c/d'] }) },
  'https://example.com/blog/a/b/c/d': { status: 200, body: page({ title: 'Post D with a reasonably long title here', description: DESC + ' d', body: LOREM(250, 'd'), links: [] }) },
  'https://example.com/old': { status: 301, headers: { location: '/older' } },
  'https://example.com/older': { status: 301, headers: { location: 'https://example.com/about' } },
  'https://example.com/loop1': { status: 302, headers: { location: '/loop2' } },
  'https://example.com/loop2': { status: 302, headers: { location: '/loop1' } },
  'https://example.com/broken': { status: 404, body: 'not found' },
  'https://example.com/slow': { status: 200, ms: 1500, body: page({ title: 'Slow page with a reasonably long title text', description: DESC + ' slow', body: LOREM(250, 'slow'), links: ['/'] }) },
  'https://example.com/orphan': { status: 200, body: page({ title: 'Orphan page with a reasonably long title text', description: DESC + ' orphan', body: LOREM(250, 'orphan'), links: ['/'] }) },
  'https://example.com/noindexed': {
    status: 200,
    body: page({ title: 'Noindexed page with a reasonably long title', description: DESC + ' n', extraHead: '<meta name="robots" content="noindex, follow">', body: LOREM(250, 'n'), links: ['/'] }),
  },
  'https://example.com/canon': {
    status: 200,
    body: page({ title: 'Canonical points at a broken page title text', description: DESC + ' canon', extraHead: '<link rel="canonical" href="https://example.com/broken">', body: LOREM(250, 'canon'), links: ['/'] }),
  },
  'https://example.com/variant': {
    status: 200,
    body: page({ title: 'Variant page that canonicalises to about page', description: DESC + ' variant', extraHead: '<link rel="canonical" href="/about">', body: LOREM(250, 'variant'), links: ['/'] }),
  },
  'https://example.com/two-canon': {
    status: 200,
    body: page({
      title: 'Two canonicals on one page with a long title',
      description: DESC + ' two',
      extraHead: '<link rel="canonical" href="/about"><link rel="canonical" href="/blog">',
      body: LOREM(250, 'two'),
      links: ['/'],
    }),
  },
  'https://example.com/throttled': { status: 429, headers: { 'retry-after': '0' } },
  'https://example.com/file.pdf': { status: 200, headers: { 'content-type': 'application/pdf' } },
}

export function fakeFetcher(site = SITE): { fetch: Fetcher; calls: string[] } {
  const calls: string[] = []
  const fetch: Fetcher = async (url, { readBody }) => {
    calls.push(url)
    const entry = site[url]
    if (!entry) return { status: 404, headers: { 'content-type': 'text/html' }, body: readBody ? 'nope' : null, elapsedMs: 5 }
    const headers = { 'content-type': 'text/html; charset=utf-8', ...(entry.headers ?? {}) }
    const res: FetchResponse = {
      status: entry.status,
      headers,
      body: readBody && entry.status < 300 && /html|xml|text\/plain/.test(headers['content-type']) ? (entry.body ?? '') : null,
      elapsedMs: entry.ms ?? 20,
    }
    // robots.txt and sitemaps are read as text whatever the content-type.
    if (readBody && (url.endsWith('robots.txt') || url.endsWith('.xml'))) res.body = entry.body ?? ''
    return res
  }
  return { fetch, calls }
}
