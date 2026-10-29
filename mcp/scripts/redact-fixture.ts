#!/usr/bin/env tsx
/**
 * Redact PII from API response fixtures before committing to the repo.
 *
 * Transformations applied:
 *   - Hostnames replaced with "example.com"
 *   - ID-like path segments (all-digit or UUID-like) replaced with "ID"
 *   - Query strings dropped
 *   - Search query tokens replaced with QUERY_1, QUERY_2, ...
 *
 * Usage:
 *   tsx scripts/redact-fixture.ts < raw-response.json > redacted-fixture.json
 *   tsx scripts/redact-fixture.ts raw-response.json   # writes to stdout
 */

import { readFileSync } from 'fs'

// Matches hostnames in URLs (http/https/sc-domain:/domain-property: prefixes)
const HOSTNAME_RE =
  /(?<=(?:https?:\/\/|sc-domain:|domain-property:))[a-zA-Z0-9.-]+(?=\/|:|$)/g

// Matches all-digit segments or UUID-like segments in URL paths
const ID_SEGMENT_RE = /(?<=\/)(\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/gi

// Query string after '?'
const QUERY_STRING_RE = /\?[^"'\s]*/g

function redactUrl(url: string): string {
  return url
    .replace(HOSTNAME_RE, 'example.com')
    .replace(ID_SEGMENT_RE, 'ID')
    .replace(QUERY_STRING_RE, '')
}

let queryCounter = 0
function tokenizeQuery(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .map(() => `QUERY_${++queryCounter}`)
    .join(' ')
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    // Keys that look like URLs
    if (
      key === 'page' ||
      key === 'url' ||
      key === 'site' ||
      value.startsWith('http') ||
      value.startsWith('sc-domain:')
    ) {
      return redactUrl(value)
    }
    // Keys that look like search queries
    if (key === 'query' || key === 'keys') {
      return tokenizeQuery(value)
    }
    return value
  }

  if (Array.isArray(value)) {
    // GSC keys[] arrays contain URL or query strings
    return (value as unknown[]).map((item, i) => {
      if (typeof item === 'string') {
        const looksLikeUrl =
          item.startsWith('http') ||
          item.startsWith('sc-domain:') ||
          item.startsWith('/')
        return looksLikeUrl ? redactUrl(item) : tokenizeQuery(item)
      }
      return redactValue(String(i), item)
    })
  }

  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>)
  }

  return value
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v)
  }
  return out
}

function redact(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map((item) =>
      typeof item === 'object' && item !== null
        ? redactObject(item as Record<string, unknown>)
        : item,
    )
  }
  if (raw !== null && typeof raw === 'object') {
    return redactObject(raw as Record<string, unknown>)
  }
  return raw
}

// ── Entry point ──────────────────────────────────────────────────────────────

const filePath = process.argv[2]
const raw = filePath ? readFileSync(filePath, 'utf-8') : readFileSync(0, 'utf-8')

const parsed: unknown = JSON.parse(raw)
const redacted = redact(parsed)
process.stdout.write(JSON.stringify(redacted, null, 2) + '\n')
