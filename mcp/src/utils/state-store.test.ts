import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { StateStore, resolveStateDir, siteKey, safeId, newId, STATE_SCHEMA_VERSION } from './state-store.js'

describe('siteKey', () => {
  it.each([
    ['sc-domain:Example.com', 'example.com'],
    ['https://www.example.com/blog?x=1', 'example.com'],
    ['example.com', 'example.com'],
    ['http://shop.example.com:8080/', 'shop.example.com'],
  ])('%s → %s', (input, want) => expect(siteKey(input)).toBe(want))

  it('rejects input that is not a host', () => {
    expect(() => siteKey('../../etc')).toThrow(/not a usable site/)
    expect(() => siteKey('')).toThrow()
  })
})

describe('safeId / newId', () => {
  it('rejects path traversal', () => {
    expect(() => safeId('../x')).toThrow()
    expect(() => safeId('.hidden')).toThrow()
    expect(safeId('20260101T000000Z-abc123')).toBe('20260101T000000Z-abc123')
  })
  it('newId sorts by time', () => {
    const a = newId(new Date('2026-01-01T00:00:00Z'))
    const b = newId(new Date('2026-01-02T00:00:00Z'))
    expect([b, a].sort()).toEqual([a, b])
    expect(a).toMatch(/^20260101T000000Z-[0-9a-f]{6}$/)
  })
})

describe('resolveStateDir', () => {
  it('prefers explicit, then env, then config dir', () => {
    expect(resolveStateDir({ stateDir: '/tmp/x', env: { GA4M_STATE_DIR: '/tmp/y' } })).toBe('/tmp/x')
    expect(resolveStateDir({ env: { GA4M_STATE_DIR: '/tmp/y' }, config: '/a/b.yaml' })).toBe('/tmp/y')
    expect(resolveStateDir({ env: {}, config: '/a/configs/site.yaml' })).toBe('/a/configs/.ga4-state')
  })
  it('falls back to home when cwd is /', () => {
    expect(resolveStateDir({ env: {}, cwd: '/' })).toBe(join(homedir(), '.ga4-state'))
  })
})

describe('StateStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ga4-state-'))
  })

  it('round-trips a snapshot in the shared envelope', () => {
    const store = new StateStore(dir)
    store.writeSnapshot('project-context', 'sc-domain:example.com', { a: 1 }, new Date('2026-01-01T00:00:00Z'))
    expect(readdirSync(dir)).toEqual(['project-context.example.com.json'])
    const snap = store.readSnapshot<{ a: number }>('project-context', 'example.com')
    expect(snap).toEqual({
      schema_version: STATE_SCHEMA_VERSION,
      command: 'project-context',
      site: 'example.com',
      generated_at: '2026-01-01T00:00:00.000Z',
      data: { a: 1 },
    })
  })

  it('returns null for a missing snapshot and leaves no temp files', () => {
    const store = new StateStore(dir)
    expect(store.readSnapshot('x', 'example.com')).toBeNull()
    store.writeRecord('audits', 'example.com', 'r1', { ok: true })
    expect(readdirSync(join(dir, 'audits', 'example.com'))).toEqual(['r1.json'])
  })

  it('lists records newest first and deletes them', () => {
    const store = new StateStore(dir)
    store.writeRecord('audits', 'example.com', '20260101T000000Z-aaaaaa', {})
    store.writeRecord('audits', 'example.com', '20260301T000000Z-bbbbbb', {})
    expect(store.listRecordIds('audits', 'example.com')).toEqual(['20260301T000000Z-bbbbbb', '20260101T000000Z-aaaaaa'])
    expect(store.deleteRecord('audits', 'example.com', '20260101T000000Z-aaaaaa')).toBe(true)
    expect(store.deleteRecord('audits', 'example.com', 'nope')).toBe(false)
    expect(store.listRecordIds('audits', 'example.com')).toHaveLength(1)
    expect(store.listSites('audits')).toEqual(['example.com'])
  })

  it('rejects an unknown schema_version', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'x.example.com.json'), JSON.stringify({ schema_version: 99, data: {} }))
    expect(() => new StateStore(dir).readSnapshot('x', 'example.com')).toThrow(/schema_version 99/)
  })
})
