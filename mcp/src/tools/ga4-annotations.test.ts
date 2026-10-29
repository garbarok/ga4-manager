import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import { ErrorCode } from '../utils/errors.js'
import {
  ga4AnnotationsInputSchema,
  ga4AnnotationsTool,
  runGa4Annotations,
} from './ga4-annotations.js'

vi.mock('../utils/google-auth.js', () => ({
  getGoogleAuthHeaders: vi.fn(),
}))

const mockAuth = vi.mocked(getGoogleAuthHeaders)
const mockFetch = vi.fn()

const day = (y: number, m: number, d: number) => ({ year: y, month: m, day: d })

beforeEach(() => {
  mockAuth.mockReset()
  mockAuth.mockResolvedValue({ Authorization: 'Bearer t' })
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runGa4Annotations list', () => {
  const page = {
    reportingDataAnnotations: [
      { name: 'properties/1/reportingDataAnnotations/a', title: 'Old', color: 'BLUE', annotationDate: day(2026, 1, 5) },
      {
        name: 'properties/1/reportingDataAnnotations/b',
        title: 'Range',
        color: 'RED',
        annotationDateRange: { startDate: day(2026, 8, 25), endDate: day(2026, 9, 3) },
      },
      { name: 'properties/1/reportingDataAnnotations/c', title: 'New', color: 'GREEN', annotationDate: day(2026, 10, 1) },
    ],
  }

  it('lists with readonly scope, defaults to list, and filters by since', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page) })
    const input = ga4AnnotationsInputSchema.parse({ property: '1', since: '2026-09-01' })
    expect(input.action).toBe('list')

    const r = await runGa4Annotations(input)
    expect(mockAuth).toHaveBeenCalledWith(['https://www.googleapis.com/auth/analytics.readonly'])
    expect(mockFetch.mock.calls[0][0]).toContain('/v1alpha/properties/1/reportingDataAnnotations?pageSize=200')
    expect(r.success && r.action === 'list' && r.annotations.map((a) => a.title)).toEqual(['Range', 'New'])
  })

  it('follows pagination', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reportingDataAnnotations: [page.reportingDataAnnotations[0]], nextPageToken: 'n' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reportingDataAnnotations: [page.reportingDataAnnotations[2]] }),
      })
    const r = await runGa4Annotations(ga4AnnotationsInputSchema.parse({ property: 'properties/1' }))
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0]).toContain('pageToken=n')
    expect(r.success && r.action === 'list' && r.count).toBe(2)
  })
})

describe('runGa4Annotations create', () => {
  it('posts the resource body with edit scope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: 'properties/1/reportingDataAnnotations/z', title: 'T' }),
    })
    const input = ga4AnnotationsInputSchema.parse({
      property: '1',
      action: 'create',
      title: 'T',
      description: 'why',
      date_range: { start: '2026-10-01', end: '2026-10-03' },
      color: 'GREEN',
    })
    const r = await runGa4Annotations(input)

    expect(mockAuth).toHaveBeenCalledWith(['https://www.googleapis.com/auth/analytics.edit'])
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://analyticsadmin.googleapis.com/v1alpha/properties/1/reportingDataAnnotations')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      title: 'T',
      description: 'why',
      color: 'GREEN',
      annotationDateRange: { startDate: day(2026, 10, 1), endDate: day(2026, 10, 3) },
    })
    expect(r.success && r.action === 'create' && r.annotation.name).toContain('/z')
  })

  it('maps a single date to annotationDate with BLUE default', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ name: 'n', title: 'T' }) })
    await runGa4Annotations(
      ga4AnnotationsInputSchema.parse({ property: '1', action: 'create', title: 'T', date: '2026-10-29' }),
    )
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      title: 'T',
      color: 'BLUE',
      annotationDate: day(2026, 10, 29),
    })
  })

  it('returns a scope/Editor hint on 403', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: () => Promise.resolve('PERMISSION_DENIED') })
    const r = await runGa4Annotations(
      ga4AnnotationsInputSchema.parse({ property: '1', action: 'create', title: 'T', date: '2026-10-29' }),
    )
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.code).toBe(ErrorCode.AUTH_DENIED)
      expect(r.error.hint).toContain('analytics.edit')
      expect(r.error.hint).toContain('Editor')
      expect(r.error.hint).toContain('0004')
    }
  })
})

describe('input validation and definition', () => {
  it('rejects create without title or date, both dates, reversed ranges and fake dates', () => {
    const p = { property: '1', action: 'create' }
    expect(ga4AnnotationsInputSchema.safeParse(p).success).toBe(false)
    expect(ga4AnnotationsInputSchema.safeParse({ ...p, title: 'T' }).success).toBe(false)
    expect(
      ga4AnnotationsInputSchema.safeParse({
        ...p,
        title: 'T',
        date: '2026-10-01',
        date_range: { start: '2026-10-01', end: '2026-10-02' },
      }).success,
    ).toBe(false)
    expect(
      ga4AnnotationsInputSchema.safeParse({
        ...p,
        title: 'T',
        date_range: { start: '2026-10-05', end: '2026-10-02' },
      }).success,
    ).toBe(false)
    expect(ga4AnnotationsInputSchema.safeParse({ ...p, title: 'T', date: '2026-02-30' }).success).toBe(false)
  })

  it('enforces GA4 length limits: title 60, description 150', () => {
    const base = { property: '1', action: 'create', date: '2026-10-01' }
    const parse = (title: string, description?: string) =>
      ga4AnnotationsInputSchema.safeParse({ ...base, title, ...(description ? { description } : {}) }).success
    expect(parse('a'.repeat(60))).toBe(true)
    expect(parse('a'.repeat(61))).toBe(false)
    expect(parse('T', 'd'.repeat(150))).toBe(true)
    expect(parse('T', 'd'.repeat(151))).toBe(false)
  })

  it('rejects ORANGE (system-generated only)', () => {
    expect(
      ga4AnnotationsInputSchema.safeParse({
        property: '1',
        action: 'create',
        title: 'T',
        date: '2026-10-01',
        color: 'ORANGE',
      }).success,
    ).toBe(false)
  })

  it('is not read-only and not destructive', () => {
    expect(ga4AnnotationsTool.name).toBe('ga4_annotations')
    expect(ga4AnnotationsTool.annotations.readOnlyHint).toBe(false)
    expect(ga4AnnotationsTool.annotations.destructiveHint).toBe(false)
  })
})
