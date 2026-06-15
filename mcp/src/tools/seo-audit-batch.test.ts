import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runSeoAuditBatch } from './seo-audit-batch.js'

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
    })

    expect(out.summary.pages_with_errors).toBe(1)
    expect(out.summary.clean).toBe(0)
  })
})
