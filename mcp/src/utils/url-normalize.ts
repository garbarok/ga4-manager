// Pure URL normalization utilities for GSC traffic comparison.

export type NormalizeMode = 'none' | 'minimal' | 'aggressive'

/**
 * Normalize a page URL before inner-joining across GSC periods.
 *
 * - none:       no change
 * - minimal:    lowercase host, strip trailing slash
 * - aggressive: minimal + drop www., force https://, drop query string
 */
export function normalizeUrl(url: string, mode: NormalizeMode): string {
  if (mode === 'none') return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Not an absolute URL (e.g. a bare path) — apply simple slash stripping only
    if (mode === 'minimal' || mode === 'aggressive') {
      return url.replace(/\/$/, '') || '/'
    }
    return url
  }

  if (mode === 'aggressive') {
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    parsed.search = ''
  } else {
    // minimal
    parsed.hostname = parsed.hostname.toLowerCase()
  }

  let result = parsed.toString()
  // Strip trailing slash on non-root paths
  if (parsed.pathname !== '/') {
    result = result.replace(/\/$/, '')
  }
  return result
}

export interface NormalizeGscSiteResult {
  site: string
  warning?: string
}

/**
 * Accept flexible GSC site formats and return the canonical form used
 * by the Search Console API.
 *
 * Accepted formats:
 *   sc-domain:example.com        → returned as-is (domain property)
 *   https://example.com/         → returned as-is (URL-prefix property)
 *   https://example.com          → adds trailing slash, emits warning
 *   example.com                  → assumes domain property, emits warning
 */
export function normalizeGscSite(input: string): NormalizeGscSiteResult {
  const trimmed = input.trim()

  if (trimmed.startsWith('sc-domain:')) {
    return { site: trimmed }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (trimmed.endsWith('/')) {
      return { site: trimmed }
    }
    return {
      site: trimmed + '/',
      warning: `Added trailing slash to URL-prefix property; use "${trimmed}/" to avoid this warning`,
    }
  }

  // Raw domain — assume sc-domain property
  const assumed = `sc-domain:${trimmed}`
  return {
    site: assumed,
    warning: `Assumed domain property "${assumed}"; pass sc-domain:${trimmed} explicitly to avoid this warning`,
  }
}
