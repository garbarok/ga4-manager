import { describe, it, expect } from 'vitest'
import { checkWriteGate } from './write-gate.js'
import { SPECS } from './registry.js'

const destructive = { title: 'd', readOnlyHint: false, destructiveHint: true }
const write = { title: 'w', readOnlyHint: false, destructiveHint: false }
const readOnly = { title: 'r', readOnlyHint: true }

describe('checkWriteGate', () => {
  it('blocks destructive tools by default with a hint naming the env var', () => {
    const r = checkWriteGate(destructive, {})
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.failure.success).toBe(false)
      expect(r.failure.error.code).toBe('INVALID_INPUT')
      expect(r.failure.error.hint).toContain('GA4M_ALLOW_DESTRUCTIVE')
    }
  })

  it('treats empty and falsy values as off', () => {
    for (const v of ['', '0', 'false', 'no']) {
      expect(checkWriteGate(destructive, { GA4M_ALLOW_DESTRUCTIVE: v }).allowed).toBe(false)
    }
  })

  it('allows destructive tools when opted in', () => {
    expect(checkWriteGate(destructive, { GA4M_ALLOW_DESTRUCTIVE: '1' }).allowed).toBe(true)
    expect(checkWriteGate(destructive, { GA4M_ALLOW_DESTRUCTIVE: 'true' }).allowed).toBe(true)
    expect(checkWriteGate(destructive, { GA4M_ALLOW_DESTRUCTIVE: 'TRUE' }).allowed).toBe(true)
  })

  it('allows non-destructive write tools by default', () => {
    expect(checkWriteGate(write, {}).allowed).toBe(true)
  })

  it('read-only mode blocks every non-read-only tool, even when destructive is allowed', () => {
    const env = { GA4M_READ_ONLY: '1', GA4M_ALLOW_DESTRUCTIVE: '1' }
    for (const a of [write, destructive, undefined]) {
      const r = checkWriteGate(a, env)
      expect(r.allowed).toBe(false)
      if (!r.allowed) expect(r.failure.error.hint).toContain('GA4M_READ_ONLY')
    }
  })

  it('read-only tools are always allowed', () => {
    expect(checkWriteGate(readOnly, {}).allowed).toBe(true)
    expect(checkWriteGate(readOnly, { GA4M_READ_ONLY: 'true' }).allowed).toBe(true)
  })
})

describe('destructive tool declarations', () => {
  it.each(['gsc_sitemaps_delete', 'ga4_cleanup', 'ga4_link_remove'])(
    '%s is flagged and described as destructive',
    (name) => {
      const tool = SPECS.find((s) => s.tool.name === name)!.tool
      expect(tool.annotations?.destructiveHint).toBe(true)
      expect(tool.description).toContain('DESTRUCTIVE:')
    },
  )
})
