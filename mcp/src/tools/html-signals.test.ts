import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  extractTitle,
  extractMetaContent,
  extractCanonical,
  countHreflang,
  extractSchemaTypes,
  extractSignals,
} from './html-signals.js'

function fixture(name: string): string {
  // cwd is mcp/ when tests run
  return readFileSync(resolve(process.cwd(), 'src/tools/__fixtures__', name), 'utf-8')
}

// ============================================================================
// Unit tests for individual extractors
// ============================================================================

describe('extractTitle', () => {
  it('extracts title from simple title tag', () => {
    expect(extractTitle('<title>My Page Title</title>')).toBe('My Page Title')
  })

  it('returns null when no title tag', () => {
    expect(extractTitle('<html><body>no title</body></html>')).toBeNull()
  })

  it('trims and collapses whitespace', () => {
    expect(extractTitle('<title>  My\n  Title  </title>')).toBe('My Title')
  })

  it('returns null for empty title tag', () => {
    expect(extractTitle('<title></title>')).toBeNull()
  })
})

describe('extractMetaContent', () => {
  it('extracts meta description', () => {
    const html = '<meta name="description" content="My description">'
    expect(extractMetaContent(html, 'description')).toBe('My description')
  })

  it('extracts og:title via property attribute', () => {
    const html = '<meta property="og:title" content="OG Title">'
    expect(extractMetaContent(html, 'og:title')).toBe('OG Title')
  })

  it('handles reversed attribute order (content before name)', () => {
    const html = '<meta content="My desc" name="description">'
    expect(extractMetaContent(html, 'description')).toBe('My desc')
  })

  it('returns null when tag not present', () => {
    expect(extractMetaContent('<html></html>', 'description')).toBeNull()
  })
})

describe('extractCanonical', () => {
  it('extracts canonical href', () => {
    const html = '<link rel="canonical" href="https://example.com/page">'
    expect(extractCanonical(html)).toBe('https://example.com/page')
  })

  it('resolves relative canonical against baseUrl', () => {
    const html = '<link rel="canonical" href="/page">'
    expect(extractCanonical(html, 'https://example.com')).toBe('https://example.com/page')
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
  it('extracts single @type', () => {
    const html = `<script type="application/ld+json">{"@type": "Article"}</script>`
    expect(extractSchemaTypes(html)).toContain('Article')
  })

  it('extracts types from @graph array', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"BreadcrumbList"}]}</script>`
    const types = extractSchemaTypes(html)
    expect(types).toContain('WebPage')
    expect(types).toContain('BreadcrumbList')
  })

  it('extracts array @type values', () => {
    const html = `<script type="application/ld+json">{"@type":["Article","NewsArticle"]}</script>`
    const types = extractSchemaTypes(html)
    expect(types).toContain('Article')
    expect(types).toContain('NewsArticle')
  })

  it('deduplicates types', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Article"}</script>
      <script type="application/ld+json">{"@type":"Article"}</script>
    `
    expect(extractSchemaTypes(html).filter((t) => t === 'Article')).toHaveLength(1)
  })

  it('handles invalid JSON-LD gracefully', () => {
    const html = `<script type="application/ld+json">{ invalid }</script>`
    expect(() => extractSchemaTypes(html)).not.toThrow()
    expect(extractSchemaTypes(html)).toHaveLength(0)
  })

  it('extracts types from multiple <script> blocks with different types', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Article"}</script>
      <script type="application/ld+json">{"@type":"WebPage"}</script>
    `
    const types = extractSchemaTypes(html)
    expect(types).toContain('Article')
    expect(types).toContain('WebPage')
    expect(types).toHaveLength(2)
  })
})

// ============================================================================
// Fixture-based tests for extractSignals
// ============================================================================

describe('extractSignals — good-baseline.html', () => {
  const html = fixture('good-baseline.html')
  const baseUrl = 'https://example.com/web-performance'
  const signals = extractSignals(html, baseUrl)

  it('extracts title text and length', () => {
    expect(signals.title).toBe('Best Practices for Web Performance')
    expect(signals.title_length).toBe(34)
    expect(signals.title_estimated_pixels).toBeGreaterThan(0)
  })

  it('extracts meta description and length', () => {
    expect(signals.description).toBe('Learn how to optimise your website for speed and Core Web Vitals.')
    expect(signals.description_length).toBeGreaterThan(0)
  })

  it('extracts canonical (resolved absolute)', () => {
    expect(signals.canonical).toBe('https://example.com/web-performance')
  })

  it('extracts OG tags', () => {
    expect(signals.og.title).toBe('Best Practices for Web Performance')
    expect(signals.og.image).toBe('https://example.com/og-image.jpg')
    expect(signals.og.type).toBe('article')
  })

  it('extracts schema types', () => {
    expect(signals.schema_types).toContain('Article')
  })

  it('counts h1 and h2', () => {
    expect(signals.h1_count).toBe(1)
    expect(signals.h2_count).toBe(2)
  })

  it('counts hreflang tags', () => {
    expect(signals.hreflang_count).toBe(3)
  })

  it('detects no noindex', () => {
    expect(signals.noindex).toBe(false)
  })
})

describe('extractSignals — missing-canonical.html', () => {
  const html = fixture('missing-canonical.html')
  const baseUrl = 'https://example.com/missing-canonical'
  const signals = extractSignals(html, baseUrl)

  it('canonical is null', () => {
    expect(signals.canonical).toBeNull()
  })

  it('extracts @graph schema types', () => {
    expect(signals.schema_types).toContain('WebPage')
    expect(signals.schema_types).toContain('BreadcrumbList')
  })

  it('has h1_count of 1', () => {
    expect(signals.h1_count).toBe(1)
  })
})

describe('extractSignals — multi-h1.html', () => {
  const html = fixture('multi-h1.html')
  const baseUrl = 'https://example.com/multi-h1'
  const signals = extractSignals(html, baseUrl)

  it('counts 3 h1 tags', () => {
    expect(signals.h1_count).toBe(3)
  })

  it('has canonical', () => {
    expect(signals.canonical).toBe('https://example.com/multi-h1')
  })

  it('extracts array @type from JSON-LD', () => {
    expect(signals.schema_types).toContain('WebPage')
    expect(signals.schema_types).toContain('ItemPage')
  })

  it('detects no noindex (robots: index, follow)', () => {
    expect(signals.noindex).toBe(false)
  })
})
