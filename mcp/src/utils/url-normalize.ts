// Pure URL normalization utilities for GSC traffic comparison and GA4 property IDs.

import { ToolError, ErrorCode } from './errors.js'

/**
 * Normalize a GA4 property identifier to "properties/N" form.
 *
 * Accepted:
 *   properties/123456789  → returned as-is
 *   123456789             → "properties/123456789"
 *
 * Rejected with INVALID_INPUT:
 *   G-XXXXXX (Measurement ID)
 *   UA-XXXXXX-X (Universal Analytics)
 *   anything else
 */
export function normalizeGa4Property(input: string): string {
  const trimmed = input.trim()

  if (/^G-[A-Z0-9]+$/i.test(trimmed)) {
    throw new ToolError(
      ErrorCode.INVALID_INPUT,
      `"${trimmed}" is a Measurement ID (G-XXXXXX), not a GA4 Property ID`,
      'Find your Property ID in GA4 Admin → Property Settings — it is a plain number like 123456789 or properties/123456789',
    )
  }

  if (/^UA-\d+-\d+$/i.test(trimmed)) {
    throw new ToolError(
      ErrorCode.INVALID_INPUT,
      `"${trimmed}" is a Universal Analytics Property ID (UA-XXXXXX-X), not a GA4 Property ID`,
      'GA4 properties use plain numeric IDs like 123456789 or properties/123456789',
    )
  }

  if (/^properties\/\d+$/.test(trimmed)) {
    return trimmed
  }

  if (/^\d+$/.test(trimmed)) {
    return `properties/${trimmed}`
  }

  throw new ToolError(
    ErrorCode.INVALID_INPUT,
    `Unrecognized GA4 property ID format: "${trimmed}"`,
    'Pass a numeric Property ID (e.g. "123456789") or "properties/123456789"',
  )
}

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
