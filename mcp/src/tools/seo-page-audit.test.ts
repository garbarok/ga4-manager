import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  seoPageAuditInputSchema,
  seoPageAuditTool,
  extractTitle,
  extractMetaContent,
  extractCanonical,
  countHreflang,
  extractSchemaTypes,
  detectIssues,
  summarizeIssues,
  fetchCwv,
  runSeoPageAudit,
  psiCache,
  SeoSignals,
} from './seo-page-audit.js'

// Mock robots-check so tests don't hit network or depend on cache state.
// clearAllMocks (used in beforeEach) preserves the implementation; resetAllMocks would clear it.
vi.mock('../utils/robots-check.js', () => ({
  isAllowed: vi.fn().mockResolvedValue(true),
}))

// ============================================================================
// Input Schema Validation
// ============================================================================

describe('seoPageAuditInputSchema', () => {
  it('accepts valid URL', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/',
    })
    expect(result.success).toBe(true)
  })

  it('applies default user_agent (GA4Manager honest UA)', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.user_agent).toContain('GA4Manager-SEO-Auditor')
    }
  })

  it('applies default check_cwv=false', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.check_cwv).toBe(false)
    }
  })

  it('applies default psi_strategy=mobile', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.psi_strategy).toBe('mobile')
    }
  })

  it('accepts full input with all options', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/page',
      user_agent: 'MyBot/1.0',
      check_cwv: true,
      psi_api_key: 'my-api-key',
      psi_strategy: 'desktop',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing url', () => {
    const result = seoPageAuditInputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL format', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid psi_strategy', () => {
    const result = seoPageAuditInputSchema.safeParse({
      url: 'https://example.com/',
      psi_strategy: 'tablet',
    })
    expect(result.success).toBe(false)
  })

  it('applies default force_refresh=false', () => {
    const result = seoPageAuditInputSchema.safeParse({ url: 'https://example.com/' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.force_refresh).toBe(false)
    }
  })
})

// ============================================================================
// HTML Signal Extraction
// ============================================================================

describe('extractTitle', () => {
  it('extracts title from simple title tag', () => {
    expect(extractTitle('<title>My Page Title</title>')).toBe('My Page Title')
  })

  it('returns null when no title tag', () => {
    expect(extractTitle('<html><body>no title</body></html>')).toBeNull()
  })

  it('trims whitespace from title', () => {
    expect(extractTitle('<title>  Trimmed Title  </title>')).toBe('Trimmed Title')
  })

  it('handles title with attributes', () => {
    expect(extractTitle('<title lang="en">My Title</title>')).toBe('My Title')
  })

  it('collapses internal whitespace', () => {
    expect(extractTitle('<title>My\n  Title</title>')).toBe('My Title')
  })

  it('returns null for empty title tag', () => {
    expect(extractTitle('<title></title>')).toBeNull()
  })
})

describe('extractMetaContent', () => {
  it('extracts meta description content', () => {
    const html = '<meta name="description" content="My description">'
    expect(extractMetaContent(html, 'description')).toBe('My description')
  })

  it('extracts og:title content', () => {
    const html = '<meta property="og:title" content="OG Title">'
    expect(extractMetaContent(html, 'og:title')).toBe('OG Title')
  })

  it('handles reversed attribute order (content before name)', () => {
    const html = '<meta content="My desc" name="description">'
    expect(extractMetaContent(html, 'description')).toBe('My desc')
  })

  it('returns null when meta tag not present', () => {
    expect(extractMetaContent('<html></html>', 'description')).toBeNull()
  })

  it('extracts robots meta content', () => {
    const html = '<meta name="robots" content="noindex, nofollow">'
    expect(extractMetaContent(html, 'robots')).toBe('noindex, nofollow')
  })
})

describe('extractCanonical', () => {
  it('extracts canonical href', () => {
    const html = '<link rel="canonical" href="https://example.com/page">'
    expect(extractCanonical(html)).toBe('https://example.com/page')
  })

  it('handles reversed attribute order (href before rel)', () => {
    const html = '<link href="https://example.com/page" rel="canonical">'
    expect(extractCanonical(html)).toBe('https://example.com/page')
  })

  it('returns null when no canonical tag', () => {
    expect(extractCanonical('<html></html>')).toBeNull()
  })
})

describe('countHreflang', () => {
  it('counts hreflang link tags', () => {
    const html = `
      <link rel="alternate" hreflang="en" href="https://example.com/">
      <link rel="alternate" hreflang="es" href="https://example.com/es/">
      <link rel="alternate" hreflang="x-default" href="https://example.com/">
    `
    expect(countHreflang(html)).toBe(3)
  })

  it('returns 0 when no hreflang tags', () => {
    expect(countHreflang('<html></html>')).toBe(0)
  })
})

describe('extractSchemaTypes', () => {
  it('extracts single @type from JSON-LD', () => {
    const html = `
      <script type="application/ld+json">
        {"@context": "https://schema.org", "@type": "Article"}
      </script>
    `
    const types = extractSchemaTypes(html)
    expect(types).toContain('Article')
  })

  it('extracts multiple types from @graph', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {"@type": "WebPage"},
            {"@type": "BreadcrumbList"}
          ]
        }
      </script>
    `
    const types = extractSchemaTypes(html)
    expect(types).toContain('WebPage')
    expect(types).toContain('BreadcrumbList')
  })

  it('handles array @type values', () => {
    const html = `
      <script type="application/ld+json">
        {"@type": ["Article", "NewsArticle"]}
      </script>
    `
    const types = extractSchemaTypes(html)
    expect(types).toContain('Article')
    expect(types).toContain('NewsArticle')
  })

  it('deduplicates types', () => {
    const html = `
      <script type="application/ld+json">{"@type": "Article"}</script>
      <script type="application/ld+json">{"@type": "Article"}</script>
    `
    const types = extractSchemaTypes(html)
    expect(types.filter((t) => t === 'Article')).toHaveLength(1)
  })

  it('returns empty array when no JSON-LD present', () => {
    expect(extractSchemaTypes('<html></html>')).toHaveLength(0)
  })

  it('gracefully handles invalid JSON-LD', () => {
    const html = `<script type="application/ld+json">{ invalid json }</script>`
    expect(() => extractSchemaTypes(html)).not.toThrow()
    expect(extractSchemaTypes(html)).toHaveLength(0)
  })
})

// ============================================================================
// Issue Detection Rules
// ============================================================================

const baseSignals: SeoSignals = {
  title: 'A Good Page Title Here',
  title_length: 25,
  description: 'A good meta description for this page content.',
  description_length: 47,
  canonical: 'https://example.com/page',
  robots: null,
  noindex: false,
  og: {
    title: 'OG Title',
    description: 'OG Description',
    image: 'https://example.com/image.jpg',
    type: 'article',
  },
  schema_types: ['Article'],
  h1_count: 1,
  h2_count: 3,
  hreflang_count: 0,
}

describe('detectIssues', () => {
  const finalUrl = 'https://example.com/page'

  it('returns no issues for a perfect page', () => {
    const issues = detectIssues(baseSignals, finalUrl)
    expect(issues).toHaveLength(0)
  })

  it('flags missing title as error', () => {
    const signals = { ...baseSignals, title: null, title_length: 0 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'title' && i.severity === 'error')).toBe(true)
  })

  it('flags short title as warning', () => {
    const signals = { ...baseSignals, title: 'Hi', title_length: 2 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'title' && i.severity === 'warning')).toBe(true)
  })

  it('flags long title as warning', () => {
    const longTitle = 'A'.repeat(75)
    const signals = { ...baseSignals, title: longTitle, title_length: 75 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'title' && i.severity === 'warning')).toBe(true)
  })

  it('accepts title exactly at 70 chars', () => {
    const signals = { ...baseSignals, title: 'A'.repeat(70), title_length: 70 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'title')).toBe(false)
  })

  it('flags missing description as warning', () => {
    const signals = { ...baseSignals, description: null, description_length: 0 }
    const issues = detectIssues(signals, finalUrl)
    expect(
      issues.some((i) => i.field === 'description' && i.severity === 'warning'),
    ).toBe(true)
  })

  it('flags long description as warning', () => {
    const longDesc = 'A'.repeat(165)
    const signals = {
      ...baseSignals,
      description: longDesc,
      description_length: 165,
    }
    const issues = detectIssues(signals, finalUrl)
    expect(
      issues.some((i) => i.field === 'description' && i.severity === 'warning'),
    ).toBe(true)
  })

  it('flags missing canonical as warning', () => {
    const signals = { ...baseSignals, canonical: null }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'canonical' && i.severity === 'warning')).toBe(
      true,
    )
  })

  it('flags canonical pointing to different domain as error', () => {
    const signals = {
      ...baseSignals,
      canonical: 'https://other-domain.com/page',
    }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'canonical' && i.severity === 'error')).toBe(
      true,
    )
  })

  it('accepts canonical on same domain', () => {
    const signals = { ...baseSignals, canonical: 'https://example.com/page' }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'canonical')).toBe(false)
  })

  it('flags noindex as error', () => {
    const signals = {
      ...baseSignals,
      robots: 'noindex',
      noindex: true,
    }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'robots' && i.severity === 'error')).toBe(true)
  })

  it('flags missing h1 as warning', () => {
    const signals = { ...baseSignals, h1_count: 0 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'h1' && i.severity === 'warning')).toBe(true)
  })

  it('flags multiple h1 as warning', () => {
    const signals = { ...baseSignals, h1_count: 3 }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'h1' && i.severity === 'warning')).toBe(true)
  })

  it('flags missing og:image as info', () => {
    const signals = {
      ...baseSignals,
      og: { ...baseSignals.og, image: null },
    }
    const issues = detectIssues(signals, finalUrl)
    expect(issues.some((i) => i.field === 'og:image' && i.severity === 'info')).toBe(true)
  })
})

describe('summarizeIssues', () => {
  it('counts issues by severity', () => {
    const issues = [
      { field: 'title', severity: 'error' as const, message: 'error' },
      { field: 'desc', severity: 'warning' as const, message: 'warning' },
      { field: 'desc2', severity: 'warning' as const, message: 'warning2' },
      { field: 'og', severity: 'info' as const, message: 'info' },
    ]
    const summary = summarizeIssues(issues)
    expect(summary.errors).toBe(1)
    expect(summary.warnings).toBe(2)
    expect(summary.infos).toBe(1)
  })

  it('returns zeros for empty issues', () => {
    const summary = summarizeIssues([])
    expect(summary.errors).toBe(0)
    expect(summary.warnings).toBe(0)
    expect(summary.infos).toBe(0)
  })
})

// ============================================================================
// fetchCwv — mocked PSI
// ============================================================================

describe('fetchCwv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('extracts CWV metrics from PSI response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            lighthouseResult: {
              categories: { performance: { score: 0.85 } },
              audits: {
                'largest-contentful-paint': { numericValue: 2500 },
                'first-contentful-paint': { numericValue: 1200 },
                'cumulative-layout-shift': { numericValue: 0.05 },
                'total-blocking-time': { numericValue: 300 },
              },
            },
          }),
      }),
    )

    const cwv = await fetchCwv('https://example.com/', 'mobile')

    expect(cwv.lcp).toBe(2500)
    expect(cwv.fcp).toBe(1200)
    expect(cwv.cls).toBe(0.05)
    expect(cwv.tbt).toBe(300)
    expect(cwv.performance_score).toBe(85)
    expect(cwv.strategy).toBe('mobile')
  })

  it('includes API key in URL when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ lighthouseResult: { categories: {}, audits: {} } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await fetchCwv('https://example.com/', 'desktop', 'my-api-key')

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('key=my-api-key')
    expect(url).toContain('strategy=desktop')
  })

  it('throws on PSI API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      }),
    )

    await expect(fetchCwv('https://example.com/', 'mobile')).rejects.toThrow(
      'PSI API error (HTTP 400)',
    )
  })
})

// ============================================================================
// PSI cache — cache key shape and force_refresh behavior
// ============================================================================

describe('PSI cache', () => {
  const PSI_RESPONSE = {
    lighthouseResult: {
      categories: { performance: { score: 0.8 } },
      audits: {
        'largest-contentful-paint': { numericValue: 2000 },
        'first-contentful-paint': { numericValue: 1000 },
        'cumulative-layout-shift': { numericValue: 0.1 },
        'total-blocking-time': { numericValue: 150 },
      },
    },
  }

  const PAGE_HTML = `<!DOCTYPE html>
<html><head>
  <title>Test Page For Cache</title>
  <meta name="description" content="Cache test description here.">
  <link rel="canonical" href="https://psi-cache-test.example.com/">
  <meta property="og:image" content="https://psi-cache-test.example.com/img.jpg">
</head><body><h1>Cache Test</h1></body></html>`

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear PSI cache between tests using a fresh store via set+get cycling is not possible,
    // but we can force-clear by deleting internal state — instead use unique URLs per test.
  })

  it('cache key is url|strategy — second call hits cache, fetch called only once for PSI', async () => {
    const testUrl = 'https://psi-cache-test.example.com/cache-hit'
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, url: testUrl, headers: { get: () => null }, text: () => Promise.resolve(PAGE_HTML) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(PSI_RESPONSE) })
      // Third call would be a second PSI fetch — should NOT happen if cache works
      .mockResolvedValueOnce({ ok: true, status: 200, url: testUrl, headers: { get: () => null }, text: () => Promise.resolve(PAGE_HTML) })
    vi.stubGlobal('fetch', mockFetch)

    const input = seoPageAuditInputSchema.parse({ url: testUrl, check_cwv: true, psi_api_key: 'key' })
    // First call — populates cache
    const r1 = await runSeoPageAudit(input)
    expect(r1.cwv).toBeDefined()

    // Second call — should hit cache; no additional PSI fetch
    const r2 = await runSeoPageAudit(input)
    expect(r2.cwv).toBeDefined()
    expect(r2.cwv?.performance_score).toBe(r1.cwv?.performance_score)

    // PSI fetch (googleapis.com) called exactly once
    const psiCalls = mockFetch.mock.calls.filter((args) =>
      typeof args[0] === 'string' && (args[0] as string).includes('googleapis.com/pagespeedonline'),
    )
    expect(psiCalls).toHaveLength(1)
  })

  it('force_refresh=true skips cache read but writes to cache', async () => {
    const testUrl = 'https://psi-cache-test.example.com/force-refresh'
    const mockFetch = vi.fn()
      .mockResolvedValue({ ok: true, status: 200, url: testUrl, headers: { get: () => null }, text: () => Promise.resolve(PAGE_HTML) })

    // Pre-populate cache so first call would normally hit it
    const cacheKey = `${testUrl}|mobile`
    psiCache.set(cacheKey, { lcp: 999, fcp: 999, cls: 0, tbt: 999, performance_score: 99, strategy: 'mobile' })

    const psiMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(PSI_RESPONSE) })
    // page fetch + psi fetch interleaved — use mockImplementation to route
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('googleapis.com')) return psiMock(url)
      return mockFetch(url)
    }))

    const input = seoPageAuditInputSchema.parse({ url: testUrl, check_cwv: true, psi_api_key: 'key', force_refresh: true })
    const result = await runSeoPageAudit(input)

    // force_refresh bypassed the cached value (99), fetched fresh (80)
    expect(result.cwv?.performance_score).toBe(80)
    expect(psiMock).toHaveBeenCalledOnce()

    // And cache was updated with the fresh value
    const cached = psiCache.get(cacheKey)
    expect(cached?.performance_score).toBe(80)
  })

  it('check_cwv=false returns no cwv block', async () => {
    const testUrl = 'https://psi-cache-test.example.com/no-cwv'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, url: testUrl, headers: { get: () => null }, text: () => Promise.resolve(PAGE_HTML),
    }))

    const input = seoPageAuditInputSchema.parse({ url: testUrl, check_cwv: false })
    const result = await runSeoPageAudit(input)

    expect(result.cwv).toBeUndefined()
  })
})

// ============================================================================
// runSeoPageAudit — integration (mocked fetch)
// ============================================================================

describe('runSeoPageAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Page Title Here</title>
  <meta name="description" content="A test page description that is reasonable length.">
  <link rel="canonical" href="https://example.com/test-page">
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Description">
  <meta property="og:image" content="https://example.com/img.jpg">
  <script type="application/ld+json">{"@type": "WebPage"}</script>
</head>
<body>
  <h1>Main Heading</h1>
  <h2>Sub Heading 1</h2>
  <h2>Sub Heading 2</h2>
</body>
</html>
`

  it('returns successful audit for well-formed page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/test-page',
        text: () => Promise.resolve(SAMPLE_HTML),
      }),
    )

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/test-page',
    })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.status_code).toBe(200)
    expect(result.signals?.title).toBe('Test Page Title Here')
    expect(result.signals?.h1_count).toBe(1)
    expect(result.signals?.h2_count).toBe(2)
    expect(result.signals?.schema_types).toContain('WebPage')
    expect(result.cwv).toBeUndefined()
  })

  it('includes status error issue for non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        url: 'https://example.com/missing',
        text: () => Promise.resolve('<html><body>Not Found</body></html>'),
      }),
    )

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/missing',
    })
    const result = await runSeoPageAudit(input)

    // success=true but status_code reflects the 404
    expect(result.success).toBe(true)
    expect(result.status_code).toBe(404)
    expect(result.issues.some((i) => i.field === 'status' && i.severity === 'error')).toBe(
      true,
    )
  })

  it('returns success=false on fetch timeout/error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
      ),
    )

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/slow-page',
    })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
  })

  it('includes cwv when check_cwv=true and PSI succeeds', async () => {
    // First fetch: the page HTML
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://example.com/page',
        text: () => Promise.resolve(SAMPLE_HTML),
      })
      // Second fetch: PSI
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            lighthouseResult: {
              categories: { performance: { score: 0.9 } },
              audits: {
                'largest-contentful-paint': { numericValue: 2000 },
                'first-contentful-paint': { numericValue: 1000 },
                'cumulative-layout-shift': { numericValue: 0.01 },
                'total-blocking-time': { numericValue: 200 },
              },
            },
          }),
      })
    vi.stubGlobal('fetch', mockFetch)

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/page',
      check_cwv: true,
      psi_api_key: 'dummy-key-to-skip-throttle',
    })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.cwv).toBeDefined()
    expect(result.cwv?.performance_score).toBe(90)
    expect(result.warnings.some((w) => w.startsWith('psi_unavailable:'))).toBe(false)
  })

  it('adds psi_unavailable warning when PSI returns 500 and omits cwv', async () => {
    const failUrl = 'https://example.com/psi-fail-test'
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: failUrl,
          text: () => Promise.resolve(SAMPLE_HTML),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        }),
    )

    const input = seoPageAuditInputSchema.parse({
      url: failUrl,
      check_cwv: true,
      psi_api_key: 'dummy-key-to-skip-throttle',
    })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.cwv).toBeUndefined()
    expect(result.warnings.some((w) => w.startsWith('psi_unavailable:'))).toBe(true)
  })

  it('uses GA4Manager honest user-agent by default', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      text: () => Promise.resolve('<html><head><title>Test</title></head><body><h1>H</h1></body></html>'),
    })
    vi.stubGlobal('fetch', mockFetch)

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/',
    })
    await runSeoPageAudit(input)

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('GA4Manager-SEO-Auditor')
  })

  it('returns issue_summary with correct counts', async () => {
    // Minimal page: missing description, missing og:image, missing h1
    const minimalHtml = `<html><head><title>OK Title Length Here</title><link rel="canonical" href="https://example.com/"></head><body></body></html>`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/',
        text: () => Promise.resolve(minimalHtml),
      }),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/' })
    const result = await runSeoPageAudit(input)

    // Expect: missing description (warning), missing og:image (info), missing h1 (warning)
    expect(result.issue_summary.warnings).toBeGreaterThanOrEqual(2)
    expect(result.issue_summary.infos).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Tool Definition
// ============================================================================

describe('seoPageAuditTool definition', () => {
  it('has correct tool name', () => {
    expect(seoPageAuditTool.name).toBe('seo_page_audit')
  })

  it('has a use-case-first description', () => {
    expect(seoPageAuditTool.description).toContain('SEO')
    expect(seoPageAuditTool.description.toLowerCase()).toContain('use when')
  })

  it('requires url field', () => {
    expect(seoPageAuditTool.inputSchema.required).toContain('url')
  })

  it('defines all optional parameters', () => {
    const props = seoPageAuditTool.inputSchema.properties
    expect(props.user_agent).toBeDefined()
    expect(props.check_cwv).toBeDefined()
    expect(props.psi_api_key).toBeDefined()
    expect(props.psi_strategy).toBeDefined()
    expect(props.force_refresh).toBeDefined()
  })
})

// ============================================================================
// runSeoPageAudit — redirect chain integration
// ============================================================================

function makeRedirectResponse(status: number, location: string) {
  return {
    ok: false,
    status,
    url: '',
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : null) },
    text: () => Promise.resolve(''),
  }
}

function makeOkResponse(url: string, body: string) {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  }
}

const GOOD_HTML = `<!DOCTYPE html>
<html><head>
  <title>Good Page Title For Testing</title>
  <meta name="description" content="Good description for this test page here.">
  <link rel="canonical" href="https://example.com/final">
  <meta property="og:image" content="https://example.com/img.jpg">
</head><body><h1>Heading</h1></body></html>`

describe('runSeoPageAudit — redirect chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('output includes redirect_chain field (empty when no redirect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeOkResponse('https://example.com/page', GOOD_HTML)),
    )
    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/page' })
    const result = await runSeoPageAudit(input)

    expect(result.redirect_chain).toBeDefined()
    expect(result.redirect_chain).toHaveLength(0)
  })

  it('multi-hop: redirect_chain has correct length and entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/step2'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/final'))
        .mockResolvedValueOnce(makeOkResponse('https://example.com/final', GOOD_HTML)),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/start' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.redirect_chain).toHaveLength(2)
    expect(result.redirect_chain[0]).toMatchObject({ from: 'https://example.com/start', status: 301 })
    expect(result.redirect_chain[1]).toMatchObject({ from: 'https://example.com/step2', status: 301 })
    expect(result.final_url).toBe('https://example.com/final')
  })

  it('redirect.chain_too_long issue fires for 4-hop chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/b'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/c'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/d'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/final'))
        .mockResolvedValueOnce(makeOkResponse('https://example.com/final', GOOD_HTML)),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/a' })
    const result = await runSeoPageAudit(input)

    expect(result.redirect_chain).toHaveLength(4)
    expect(result.issues.some((i) => i.field === 'redirect.chain_too_long' && i.severity === 'warning')).toBe(true)
  })

  it('returns success=false with error message on redirect loop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/b'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/a')),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/a' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/loop/i)
    expect(result.redirect_chain).toHaveLength(0)
  })

  it('returns success=false with error message when hop limit exceeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/b'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/c'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/d'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/e'))
        .mockResolvedValueOnce(makeRedirectResponse(301, 'https://example.com/f')),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/a' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/hop limit/i)
  })
})

// ============================================================================
// runSeoPageAudit — meta-refresh detection
// ============================================================================

describe('runSeoPageAudit — meta-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds meta_refresh info issue when meta http-equiv="refresh" present', async () => {
    const htmlWithRefresh = `<!DOCTYPE html>
<html><head>
  <title>Redirecting Page Title OK</title>
  <meta name="description" content="This page redirects you soon.">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:image" content="https://example.com/img.jpg">
  <meta http-equiv="refresh" content="5; url=https://example.com/new-page">
</head><body><h1>Redirecting</h1></body></html>`

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/',
        headers: { get: () => null },
        text: () => Promise.resolve(htmlWithRefresh),
      }),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    const metaIssue = result.issues.find((i) => i.field === 'meta_refresh')
    expect(metaIssue).toBeDefined()
    expect(metaIssue?.severity).toBe('info')
    expect(metaIssue?.message).toContain('https://example.com/new-page')
  })

  it('no meta_refresh issue when tag absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/',
        headers: { get: () => null },
        text: () => Promise.resolve(GOOD_HTML),
      }),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/' })
    const result = await runSeoPageAudit(input)

    expect(result.issues.some((i) => i.field === 'meta_refresh')).toBe(false)
  })
})

// ============================================================================
// robots.txt + as_googlebot integration
// ============================================================================

describe('runSeoPageAudit — robots.txt respect', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    // Re-import the mock so we can control it per-test
    const robotsCheck = await import('../utils/robots-check.js')
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(true)
  })

  it('returns blocked_by_robots=true when robots disallows URL', async () => {
    const robotsCheck = await import('../utils/robots-check.js')
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(false)

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/secret' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.blocked_by_robots).toBe(true)
    expect(result.signals).toBeNull()
    expect(result.issues).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('robots.txt')
  })

  it('fetches page when robots allows URL', async () => {
    const robotsCheck = await import('../utils/robots-check.js')
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(true)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeOkResponse('https://example.com/', GOOD_HTML)),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.blocked_by_robots).toBeUndefined()
    expect(result.signals).not.toBeNull()
  })

  it('treats robots.txt fetch failure as allowed (fetches page)', async () => {
    const robotsCheck = await import('../utils/robots-check.js')
    // isAllowed returns true when fetch fails (tested in robots-check unit tests)
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(true)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeOkResponse('https://example.com/', GOOD_HTML)),
    )

    const input = seoPageAuditInputSchema.parse({ url: 'https://example.com/' })
    const result = await runSeoPageAudit(input)

    expect(result.success).toBe(true)
    expect(result.blocked_by_robots).toBeUndefined()
  })

  it('as_googlebot=true overrides user_agent with Googlebot UA', async () => {
    const robotsCheck = await import('../utils/robots-check.js')
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(true)

    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse('https://example.com/', GOOD_HTML))
    vi.stubGlobal('fetch', mockFetch)

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/',
      as_googlebot: true,
    })
    await runSeoPageAudit(input)

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['User-Agent']).toContain('Googlebot')
  })

  it('respect_robots=false skips robots check and fetches directly', async () => {
    const robotsCheck = await import('../utils/robots-check.js')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeOkResponse('https://example.com/', GOOD_HTML)),
    )

    const input = seoPageAuditInputSchema.parse({
      url: 'https://example.com/',
      respect_robots: false,
    })
    await runSeoPageAudit(input)

    expect(robotsCheck.isAllowed).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Per-host throttle
// ============================================================================

describe('runSeoPageAudit — per-host throttle', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    const robotsCheck = await import('../utils/robots-check.js')
    vi.mocked(robotsCheck.isAllowed).mockResolvedValue(true)
  })

  it('two same-host requests complete sequentially (not concurrently)', async () => {
    const callOrder: number[] = []
    const mockFetch = vi.fn().mockImplementation(async () => {
      callOrder.push(Date.now())
      return makeOkResponse('https://example.com/', GOOD_HTML)
    })
    vi.stubGlobal('fetch', mockFetch)

    const inputA = seoPageAuditInputSchema.parse({ url: 'https://example.com/a' })
    const inputB = seoPageAuditInputSchema.parse({ url: 'https://example.com/b' })

    // Fire both in parallel
    await Promise.all([runSeoPageAudit(inputA), runSeoPageAudit(inputB)])

    // Both should complete; throttle ensures ≥1s apart
    expect(callOrder).toHaveLength(2)
    expect(callOrder[1] - callOrder[0]).toBeGreaterThanOrEqual(990) // allow 10ms jitter
  }, 10_000)
})
