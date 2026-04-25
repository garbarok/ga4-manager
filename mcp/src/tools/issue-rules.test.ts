import { describe, it, expect } from 'vitest'
import { runIssueRules, summarizeIssues, type SeoIssue } from './issue-rules.js'
import type { HtmlSignals } from './html-signals.js'

const baseSignals: HtmlSignals = {
  title: 'A Good Page Title Here For Testing',
  title_length: 35,
  description: 'A good meta description for this page that is reasonable length.',
  description_length: 64,
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

const finalUrl = 'https://example.com/page'

describe('runIssueRules', () => {
  it('returns no issues for a perfect page', () => {
    expect(runIssueRules(baseSignals, finalUrl)).toHaveLength(0)
  })

  // Title rules
  it('flags missing title as error', () => {
    const signals = { ...baseSignals, title: null, title_length: 0 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'title' && i.severity === 'error')).toBe(true)
  })

  it('flags short title (<10 chars) as warning', () => {
    const signals = { ...baseSignals, title: 'Hi', title_length: 2 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'title' && i.severity === 'warning')).toBe(true)
  })

  it('flags long title (>70 chars) as warning', () => {
    const signals = { ...baseSignals, title: 'A'.repeat(71), title_length: 71 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'title' && i.severity === 'warning')).toBe(true)
  })

  it('accepts title at exactly 70 chars', () => {
    const signals = { ...baseSignals, title: 'A'.repeat(70), title_length: 70 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'title')).toBe(false)
  })

  // Description rules
  it('flags missing description as warning', () => {
    const signals = { ...baseSignals, description: null, description_length: 0 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'description' && i.severity === 'warning')).toBe(true)
  })

  it('flags description >160 chars as warning', () => {
    const signals = { ...baseSignals, description: 'A'.repeat(161), description_length: 161 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'description' && i.severity === 'warning')).toBe(true)
  })

  it('accepts description at exactly 160 chars', () => {
    const signals = { ...baseSignals, description: 'A'.repeat(160), description_length: 160 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'description')).toBe(false)
  })

  // Canonical rules
  it('flags missing canonical as warning', () => {
    const signals = { ...baseSignals, canonical: null }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'canonical' && i.severity === 'warning')).toBe(true)
  })

  it('flags cross-domain canonical as error', () => {
    const signals = { ...baseSignals, canonical: 'https://other-domain.com/page' }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'canonical' && i.severity === 'error')).toBe(true)
  })

  it('accepts same-domain canonical', () => {
    const signals = { ...baseSignals, canonical: 'https://example.com/page' }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'canonical')).toBe(false)
  })

  it('flags invalid canonical URL as warning', () => {
    const signals = { ...baseSignals, canonical: 'not-a-url' }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'canonical' && i.severity === 'warning')).toBe(true)
  })

  // Robots noindex rule
  it('flags noindex as error', () => {
    const signals = { ...baseSignals, robots: 'noindex, nofollow', noindex: true }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'robots' && i.severity === 'error')).toBe(true)
  })

  it('does not flag index, follow robots as error', () => {
    const signals = { ...baseSignals, robots: 'index, follow', noindex: false }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'robots')).toBe(false)
  })

  // H1 rules
  it('flags missing h1 as warning', () => {
    const signals = { ...baseSignals, h1_count: 0 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'h1' && i.severity === 'warning')).toBe(true)
  })

  it('flags multiple h1 as warning', () => {
    const signals = { ...baseSignals, h1_count: 3 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'h1' && i.severity === 'warning')).toBe(true)
  })

  it('accepts exactly one h1', () => {
    const signals = { ...baseSignals, h1_count: 1 }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'h1')).toBe(false)
  })

  // OG image rule
  it('flags missing og:image as info', () => {
    const signals = { ...baseSignals, og: { ...baseSignals.og, image: null } }
    const issues = runIssueRules(signals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'og:image' && i.severity === 'info')).toBe(true)
  })

  it('does not flag og:image when present', () => {
    const issues = runIssueRules(baseSignals, finalUrl)
    expect(issues.some((i: SeoIssue) => i.field === 'og:image')).toBe(false)
  })
})

describe('summarizeIssues', () => {
  it('counts by severity', () => {
    const issues: SeoIssue[] = [
      { field: 'title', severity: 'error', message: 'e' },
      { field: 'desc', severity: 'warning', message: 'w' },
      { field: 'desc2', severity: 'warning', message: 'w2' },
      { field: 'og', severity: 'info', message: 'i' },
    ]
    const s = summarizeIssues(issues)
    expect(s.errors).toBe(1)
    expect(s.warnings).toBe(2)
    expect(s.infos).toBe(1)
  })

  it('returns zeros for empty list', () => {
    const s = summarizeIssues([])
    expect(s.errors).toBe(0)
    expect(s.warnings).toBe(0)
    expect(s.infos).toBe(0)
  })
})

// ============================================================================
// Redirect chain rules
// ============================================================================

import type { RedirectHop } from '../utils/redirect-trace.js'

describe('runIssueRules — redirect chain', () => {
  it('no issues when chain is empty', () => {
    const issues = runIssueRules(baseSignals, finalUrl, [])
    expect(issues.some((i: SeoIssue) => i.field.startsWith('redirect.'))).toBe(false)
  })

  it('redirect.chain_too_long: fires when chain length > 3', () => {
    const chain: RedirectHop[] = [
      { from: 'https://example.com/a', to: 'https://example.com/b', status: 301 },
      { from: 'https://example.com/b', to: 'https://example.com/c', status: 301 },
      { from: 'https://example.com/c', to: 'https://example.com/d', status: 301 },
      { from: 'https://example.com/d', to: 'https://example.com/page', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, finalUrl, chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.chain_too_long' && i.severity === 'warning')).toBe(true)
  })

  it('redirect.chain_too_long: does NOT fire for chain of exactly 3', () => {
    const chain: RedirectHop[] = [
      { from: 'https://example.com/a', to: 'https://example.com/b', status: 301 },
      { from: 'https://example.com/b', to: 'https://example.com/c', status: 301 },
      { from: 'https://example.com/c', to: 'https://example.com/page', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, finalUrl, chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.chain_too_long')).toBe(false)
  })

  it('redirect.non_permanent: fires when chain contains a 302', () => {
    const chain: RedirectHop[] = [
      { from: 'https://example.com/a', to: 'https://example.com/page', status: 302 },
    ]
    const issues = runIssueRules(baseSignals, finalUrl, chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.non_permanent' && i.severity === 'info')).toBe(true)
  })

  it('redirect.non_permanent: does NOT fire for 301-only chain', () => {
    const chain: RedirectHop[] = [
      { from: 'https://example.com/a', to: 'https://example.com/page', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, finalUrl, chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.non_permanent')).toBe(false)
  })

  it('redirect.cross_domain: fires when eTLD+1 differs between start and final URL', () => {
    const chain: RedirectHop[] = [
      { from: 'https://old-site.com/', to: 'https://example.com/page', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, 'https://example.com/page', chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.cross_domain' && i.severity === 'warning')).toBe(true)
  })

  it('redirect.cross_domain: does NOT fire for same eTLD+1 (different subdomain)', () => {
    const chain: RedirectHop[] = [
      { from: 'https://www.example.com/', to: 'https://example.com/page', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, 'https://example.com/page', chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.cross_domain')).toBe(false)
  })

  it('redirect.loop: fires when same URL appears twice in chain', () => {
    const chain: RedirectHop[] = [
      { from: 'https://example.com/a', to: 'https://example.com/b', status: 301 },
      { from: 'https://example.com/a', to: 'https://example.com/c', status: 301 },
    ]
    const issues = runIssueRules(baseSignals, finalUrl, chain)
    expect(issues.some((i: SeoIssue) => i.field === 'redirect.loop' && i.severity === 'error')).toBe(true)
  })
})
