import { describe, it, expect } from 'vitest'
import { normalizeUrl, normalizeGscSite } from './url-normalize.js'

// ============================================================================
// normalizeUrl
// ============================================================================

describe('normalizeUrl — mode: none', () => {
  it('returns URL unchanged', () => {
    expect(normalizeUrl('https://Example.COM/Page/', 'none')).toBe('https://Example.COM/Page/')
  })

  it('preserves query string', () => {
    expect(normalizeUrl('https://example.com/page?q=1', 'none')).toBe('https://example.com/page?q=1')
  })

  it('preserves www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page', 'none')).toBe('https://www.example.com/page')
  })
})

describe('normalizeUrl — mode: minimal', () => {
  it('strips trailing slash on non-root path', () => {
    expect(normalizeUrl('https://example.com/page/', 'minimal')).toBe('https://example.com/page')
  })

  it('lowercases host', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/page', 'minimal')).toBe('https://example.com/page')
  })

  it('preserves trailing slash on root path', () => {
    expect(normalizeUrl('https://example.com/', 'minimal')).toBe('https://example.com/')
  })

  it('preserves query string', () => {
    expect(normalizeUrl('https://example.com/page?q=hello', 'minimal')).toBe(
      'https://example.com/page?q=hello',
    )
  })

  it('preserves www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page', 'minimal')).toBe(
      'https://www.example.com/page',
    )
  })

  it('handles URL with mixed-case host and trailing slash', () => {
    expect(normalizeUrl('https://Example.COM/Blog/', 'minimal')).toBe('https://example.com/Blog')
  })
})

describe('normalizeUrl — mode: aggressive', () => {
  it('drops trailing slash on non-root path', () => {
    expect(normalizeUrl('https://example.com/page/', 'aggressive')).toBe('https://example.com/page')
  })

  it('lowercases host', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/page', 'aggressive')).toBe('https://example.com/page')
  })

  it('drops www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page', 'aggressive')).toBe(
      'https://example.com/page',
    )
  })

  it('forces https scheme from http', () => {
    expect(normalizeUrl('http://example.com/page', 'aggressive')).toBe('https://example.com/page')
  })

  it('drops query string', () => {
    expect(normalizeUrl('https://example.com/page?q=hello&foo=bar', 'aggressive')).toBe(
      'https://example.com/page',
    )
  })

  it('applies all transforms together', () => {
    expect(
      normalizeUrl('http://WWW.Example.COM/Blog/?utm_source=google', 'aggressive'),
    ).toBe('https://example.com/Blog')
  })

  it('preserves root path', () => {
    expect(normalizeUrl('http://www.example.com/', 'aggressive')).toBe('https://example.com/')
  })

  it('different forms of same logical URL collapse to same key', () => {
    const a = normalizeUrl('https://www.Example.COM/Blog/', 'aggressive')
    const b = normalizeUrl('http://example.com/Blog?foo=bar', 'aggressive')
    expect(a).toBe(b)
  })
})

describe('normalizeUrl — non-absolute URL', () => {
  it('strips trailing slash from relative path under minimal', () => {
    expect(normalizeUrl('/blog/', 'minimal')).toBe('/blog')
  })

  it('returns relative path unchanged under none', () => {
    expect(normalizeUrl('/blog/', 'none')).toBe('/blog/')
  })
})

// ============================================================================
// normalizeGscSite
// ============================================================================

describe('normalizeGscSite', () => {
  it('accepts sc-domain: prefix as-is, no warning', () => {
    const result = normalizeGscSite('sc-domain:example.com')
    expect(result.site).toBe('sc-domain:example.com')
    expect(result.warning).toBeUndefined()
  })

  it('accepts https URL with trailing slash as-is, no warning', () => {
    const result = normalizeGscSite('https://example.com/')
    expect(result.site).toBe('https://example.com/')
    expect(result.warning).toBeUndefined()
  })

  it('accepts http URL with trailing slash as-is, no warning', () => {
    const result = normalizeGscSite('http://example.com/')
    expect(result.site).toBe('http://example.com/')
    expect(result.warning).toBeUndefined()
  })

  it('adds trailing slash to https URL without one, emits warning', () => {
    const result = normalizeGscSite('https://example.com')
    expect(result.site).toBe('https://example.com/')
    expect(result.warning).toContain('trailing slash')
  })

  it('adds trailing slash to http URL without one, emits warning', () => {
    const result = normalizeGscSite('http://example.com')
    expect(result.site).toBe('http://example.com/')
    expect(result.warning).toContain('trailing slash')
  })

  it('raw domain assumes sc-domain property, emits warning', () => {
    const result = normalizeGscSite('example.com')
    expect(result.site).toBe('sc-domain:example.com')
    expect(result.warning).toContain('sc-domain:example.com')
  })

  it('raw subdomain assumes sc-domain property', () => {
    const result = normalizeGscSite('blog.example.com')
    expect(result.site).toBe('sc-domain:blog.example.com')
    expect(result.warning).toBeDefined()
  })

  it('trims whitespace before processing', () => {
    const result = normalizeGscSite('  sc-domain:example.com  ')
    expect(result.site).toBe('sc-domain:example.com')
    expect(result.warning).toBeUndefined()
  })

  it('https URL with path and trailing slash passes through', () => {
    const result = normalizeGscSite('https://example.com/subfolder/')
    expect(result.site).toBe('https://example.com/subfolder/')
    expect(result.warning).toBeUndefined()
  })
})
