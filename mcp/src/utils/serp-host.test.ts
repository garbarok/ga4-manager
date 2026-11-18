import { describe, it, expect } from 'vitest'
import { isWrappedUrl, resultHost, resultUrl, hostMatchesSite, referenceHost } from './serp-host.js'

// Shapes captured from live DataForSEO and ValueSERP responses (2026-11-18), with neutral hosts.
const DFS_WRAPPED = {
  url: 'https://google.com/goto?url=CAESfwHEIkXXDI3Cyg6jOmpwHk645d3ozk5mXNTun4',
  domain: 'google.com',
  breadcrumb: 'https://www.example.com › noticias › comprobar-it...',
  website_name: 'Example',
}
const DFS_WRAPPED_NO_PATH = { url: 'https://google.com/goto?url=CAESWgHE', domain: 'google.com', breadcrumb: 'https://example.org', website_name: 'example.org' }
const VS_WRAPPED = { url: 'https://www.google.com/goto?url=CAEScQHE', domain: 'example.net', displayed_link: 'https://example.net › Blog' }

describe('serp-host', () => {
  it('detects Google redirect wrappers', () => {
    expect(isWrappedUrl(DFS_WRAPPED.url)).toBe(true)
    expect(isWrappedUrl('https://www.google.es/url?q=https://x.com')).toBe(true)
    expect(isWrappedUrl('https://www.example.com/goto?x')).toBe(false)
    expect(isWrappedUrl('https://www.google.com/maps')).toBe(false)
  })

  it('recovers the real host from breadcrumb, displayed_link, domain or website_name', () => {
    expect(resultHost(DFS_WRAPPED)).toBe('www.example.com')
    expect(resultHost(DFS_WRAPPED_NO_PATH)).toBe('example.org')
    expect(resultHost(VS_WRAPPED)).toBe('example.net')
    expect(resultHost({ url: DFS_WRAPPED.url, domain: 'google.com', website_name: 'shop.example.com' })).toBe('shop.example.com')
    expect(resultHost({ url: DFS_WRAPPED.url, domain: 'google.com', website_name: 'Some Shop' })).toBeNull()
    expect(resultHost({ url: 'https://plain.example.com/a', domain: 'plain.example.com' })).toBe('plain.example.com')
  })

  it('never reports a wrapped link as the page URL', () => {
    expect(resultUrl(DFS_WRAPPED)).toEqual({ url: null, url_wrapped: DFS_WRAPPED.url, url_hint: 'https://www.example.com/noticias/comprobar-it' })
    expect(resultUrl(DFS_WRAPPED_NO_PATH).url_hint).toBe('https://example.org/')
    expect(resultUrl({ url: 'https://a.example/x' })).toEqual({ url: 'https://a.example/x', url_wrapped: null, url_hint: null })
  })

  it('matches sites www-insensitively, subdomains included', () => {
    expect(hostMatchesSite('www.example.com', 'example.com')).toBe(true)
    expect(hostMatchesSite('blog.example.com', 'www.example.com')).toBe(true)
    expect(hostMatchesSite('notexample.com', 'example.com')).toBe(false)
    expect(hostMatchesSite(null, 'example.com')).toBe(false)
  })

  it('identifies AI-answer references from domain, url or source', () => {
    expect(referenceHost({ domain: 'example.com' })).toBe('example.com')
    expect(referenceHost({ url: 'https://google.com/goto?url=X', source: 'example.org' })).toBe('example.org')
    expect(referenceHost({ url: 'https://google.com/goto?url=X', source: 'Example Blog' })).toBeNull()
  })
})
