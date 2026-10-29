import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { runSeoAuditBatch } from './seo-audit-batch.js'
import type { CrawlerRunner } from '../utils/siteone-crawler.js'

// Bypass robots.txt so the audit proceeds to the (mocked) fetch.
vi.mock('../utils/robots-check.js', () => ({
  isAllowed: vi.fn().mockResolvedValue(true),
}))

const SITEMAP_INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap>
</sitemapindex>`

const SITEMAP_URLSET = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a/</loc></url>
  <url><loc>https://example.com/b/</loc></url>
</urlset>`

function htmlResponse(status: number, body = '<html><head><title>x</title></head><body></body></html>') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://example.com/',
    headers: new Headers({ 'content-type': 'text/html' }),
    text: () => Promise.resolve(body),
  }
}

describe('runSeoAuditBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('expands a sitemap index and audits each page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL) => {
        const u = url.toString()
        if (u.endsWith('sitemap-index.xml')) return Promise.resolve(htmlResponse(200, SITEMAP_INDEX))
        if (u.endsWith('sitemap-0.xml')) return Promise.resolve(htmlResponse(200, SITEMAP_URLSET))
        return Promise.resolve(htmlResponse(200))
      }),
    )

    const out = await runSeoAuditBatch({
      sitemap: 'https://example.com/sitemap-index.xml',
      limit: 50,
      concurrency: 2,
      check_cwv: false,
      psi_strategy: 'mobile',
      respect_robots: true,
      as_googlebot: true,
      render_js: false,
    })

    expect(out.success).toBe(true)
    expect(out.total_candidates).toBe(2)
    expect(out.summary.audited).toBe(2)
    expect(out.results.map((r) => r.url).sort()).toEqual([
      'https://example.com/a/',
      'https://example.com/b/',
    ])
  })

  it('truncates to limit and records a warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(200)))

    const out = await runSeoAuditBatch({
      urls: ['https://example.com/1/', 'https://example.com/2/', 'https://example.com/3/'],
      limit: 2,
      concurrency: 2,
      check_cwv: false,
      psi_strategy: 'mobile',
      respect_robots: true,
      as_googlebot: true,
      render_js: false,
    })

    expect(out.truncated).toBe(true)
    expect(out.total_candidates).toBe(3)
    expect(out.results).toHaveLength(2)
    expect(out.warnings.some((w) => w.includes('truncated'))).toBe(true)
  })

  it('counts a 404 page as an error in the summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(404)))

    const out = await runSeoAuditBatch({
      urls: ['https://example.com/missing/'],
      limit: 50,
      concurrency: 1,
      check_cwv: false,
      psi_strategy: 'mobile',
      respect_robots: true,
      as_googlebot: true,
      render_js: false,
    })

    expect(out.summary.pages_with_errors).toBe(1)
    expect(out.summary.clean).toBe(0)
  })

  const base = {
    limit: 50,
    concurrency: 2,
    check_cwv: false,
    psi_strategy: 'mobile' as const,
    respect_robots: true,
    as_googlebot: true,
    render_js: false,
  }

  it('applies include then exclude regexes before auditing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(200))
    vi.stubGlobal('fetch', fetchMock)

    const out = await runSeoAuditBatch({
      ...base,
      urls: [
        'https://example.com/blog/a',
        'https://example.com/blog/draft-b',
        'https://example.com/shop/c',
      ],
      include: ['/blog/'],
      exclude: ['draft'],
    })

    expect(out.results.map((r) => r.url)).toEqual(['https://example.com/blog/a'])
    expect(out.total_candidates).toBe(1)
    expect(out.filtered_out).toBe(2)
  })

  it('fails on an invalid regex without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const out = await runSeoAuditBatch({ ...base, urls: ['https://example.com/a'], include: ['('] })

    expect(out.success).toBe(false)
    expect(out.error).toMatch(/invalid include regex/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('audits SiteOne-discovered HTML URLs and returns broken links and redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(200)))
    const report = {
      results: [
        { url: 'https://example.com/', status: '200', type: 1 },
        { url: 'https://example.com/team', status: '200', type: 1 },
        { url: 'https://example.com/app.js', status: '200', type: 2 },
        { url: 'https://example.com/gone', status: '404', type: 1 },
      ],
      tables: {
        redirects: [{ statusCode: 301, url: 'https://example.com/old', targetUrl: 'https://example.com/team' }],
      },
    }
    const runner: CrawlerRunner = async (_bin, args) => {
      const flag = args.find((a) => a.startsWith('--output-json-file='))!
      await writeFile(flag.slice('--output-json-file='.length), JSON.stringify(report))
      return { exitCode: 0, stderr: '' }
    }

    const out = await runSeoAuditBatch(
      { ...base, discover: { siteone: { start_url: 'https://example.com/', max_urls: 200 } } },
      { runner, resolveBinary: async () => '/bin/siteone-crawler' },
    )

    expect(out.success).toBe(true)
    expect(out.results.map((r) => r.url)).toEqual(['https://example.com/', 'https://example.com/team'])
    expect(out.discovery).toEqual({
      source: 'siteone',
      discovered_html: 2,
      broken_links: [{ url: 'https://example.com/gone', status: 404 }],
      redirects: [{ url: 'https://example.com/old', target_url: 'https://example.com/team', status: 301 }],
    })
  })

  it('fails with an install hint when siteone-crawler is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const out = await runSeoAuditBatch(
      { ...base, discover: { siteone: { start_url: 'https://example.com/', max_urls: 200 } } },
      { resolveBinary: async () => null },
    )

    expect(out.success).toBe(false)
    expect(out.error).toContain('https://github.com/janreges/siteone-crawler')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts a redirect loop in the summary and surfaces the error issue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL) => {
        const from = url.toString()
        const to = from.endsWith('/a') ? 'https://example.com/b' : 'https://example.com/a'
        return Promise.resolve({
          ok: false,
          status: 301,
          headers: new Headers({ location: to }),
          text: () => Promise.resolve(''),
        })
      }),
    )

    const out = await runSeoAuditBatch({ ...base, urls: ['https://example.com/a'] })

    expect(out.summary.redirect_loops).toBe(1)
    expect(out.results[0].issues.some((i) => i.field === 'redirect_loop' && i.severity === 'error')).toBe(true)
  })
})
