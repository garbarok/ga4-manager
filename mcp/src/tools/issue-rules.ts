// ============================================================================
// issue-rules.ts — pure issue detection engine, no I/O
// ============================================================================

import { parse as parseDomain } from 'tldts'
import type { HtmlSignals } from './html-signals.js'
import type { RedirectHop } from '../utils/redirect-trace.js'

export interface SeoIssue {
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface IssueSummary {
  errors: number
  warnings: number
  infos: number
}

function registrableDomain(url: string): string | null {
  try {
    return parseDomain(url).domain ?? null
  } catch {
    return null
  }
}

export function runIssueRules(signals: HtmlSignals, finalUrl: string, chain: RedirectHop[] = []): SeoIssue[] {
  const issues: SeoIssue[] = []

  // ── Redirect chain rules ──────────────────────────────────────────────────

  if (chain.length > 0) {
    // redirect.loop — same URL visited twice in chain
    const seen = new Set<string>()
    for (const hop of chain) {
      if (seen.has(hop.from)) {
        issues.push({ field: 'redirect.loop', severity: 'error', message: `Redirect loop: ${hop.from} was visited twice` })
        break
      }
      seen.add(hop.from)
    }

    // redirect.chain_too_long — more than 3 hops
    if (chain.length > 3) {
      issues.push({
        field: 'redirect.chain_too_long',
        severity: 'warning',
        message: `Redirect chain is ${chain.length} hops long (max recommended: 3)`,
      })
    }

    // redirect.non_permanent — any 302 in chain
    if (chain.some((h) => h.status === 302)) {
      issues.push({
        field: 'redirect.non_permanent',
        severity: 'info',
        message: 'Redirect chain contains a 302 (temporary) redirect; use 301 for SEO-safe permanent redirects',
      })
    }

    // redirect.cross_domain — final eTLD+1 differs from start eTLD+1
    const startUrl = chain[0].from
    const startDomain = registrableDomain(startUrl)
    const finalDomain = registrableDomain(finalUrl)
    if (startDomain && finalDomain && startDomain !== finalDomain) {
      issues.push({
        field: 'redirect.cross_domain',
        severity: 'warning',
        message: `Redirect crosses domain boundary: ${startDomain} → ${finalDomain}`,
      })
    }
  }

  // ── Title ─────────────────────────────────────────────────────────────────

  if (!signals.title) {
    issues.push({ field: 'title', severity: 'error', message: 'Page is missing a <title> tag' })
  } else {
    if (signals.title_length < 10) {
      issues.push({
        field: 'title',
        severity: 'warning',
        message: `Title is too short (${signals.title_length} chars, minimum 10)`,
      })
    } else if (signals.title_length > 70) {
      issues.push({
        field: 'title',
        severity: 'warning',
        message: `Title may be truncated in SERPs (${signals.title_length} chars, max 70)`,
      })
    }
  }

  // ── Description ───────────────────────────────────────────────────────────

  if (!signals.description) {
    issues.push({ field: 'description', severity: 'warning', message: 'Page is missing a meta description' })
  } else if (signals.description_length > 160) {
    issues.push({
      field: 'description',
      severity: 'warning',
      message: `Meta description may be truncated (${signals.description_length} chars, max 160)`,
    })
  }

  // ── Canonical ─────────────────────────────────────────────────────────────

  if (!signals.canonical) {
    issues.push({ field: 'canonical', severity: 'warning', message: 'Page is missing a canonical link tag' })
  } else {
    try {
      const canonicalHost = new URL(signals.canonical).hostname
      const finalHost = new URL(finalUrl).hostname
      if (canonicalHost !== finalHost) {
        issues.push({
          field: 'canonical',
          severity: 'error',
          message: `Canonical points to different domain: ${signals.canonical}`,
        })
      }
    } catch {
      issues.push({
        field: 'canonical',
        severity: 'warning',
        message: `Canonical URL appears invalid: ${signals.canonical}`,
      })
    }
  }

  // ── Robots noindex ────────────────────────────────────────────────────────

  if (signals.noindex) {
    issues.push({
      field: 'robots',
      severity: 'error',
      message: `Page has noindex directive: ${signals.robots}`,
    })
  }

  // ── H1 ────────────────────────────────────────────────────────────────────

  if (signals.h1_count === 0) {
    issues.push({ field: 'h1', severity: 'warning', message: 'Page has no <h1> tag' })
  } else if (signals.h1_count > 1) {
    issues.push({
      field: 'h1',
      severity: 'warning',
      message: `Page has multiple <h1> tags (${signals.h1_count})`,
    })
  }

  // ── OG image ──────────────────────────────────────────────────────────────

  if (!signals.og.image) {
    issues.push({ field: 'og:image', severity: 'info', message: 'Page is missing og:image meta tag' })
  }

  return issues
}

export function summarizeIssues(issues: SeoIssue[]): IssueSummary {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
  }
}
