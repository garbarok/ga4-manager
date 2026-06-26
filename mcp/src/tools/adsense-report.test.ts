import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adsenseGet } from '../utils/adsense-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import {
  adsenseReportInputSchema,
  adsenseReportTool,
  runAdsenseReport,
} from './adsense-report.js'

vi.mock('../utils/adsense-client.js', () => ({
  adsenseGet: vi.fn(),
}))

const mockGet = vi.mocked(adsenseGet)

beforeEach(() => {
  mockGet.mockReset()
})

const SAMPLE_REPORT = {
  headers: [
    { name: 'DATE', type: 'DIMENSION' },
    { name: 'ESTIMATED_EARNINGS', type: 'METRIC_CURRENCY', currencyCode: 'USD' },
  ],
  rows: [{ cells: [{ value: '2026-06-01' }, { value: '1.23' }] }],
  totals: { cells: [{ value: '' }, { value: '1.23' }] },
  totalMatchedRows: '1',
  startDate: { year: 2026, month: 6, day: 1 },
  endDate: { year: 2026, month: 6, day: 7 },
}

describe('adsenseReportInputSchema', () => {
  it('applies defaults', () => {
    const parsed = adsenseReportInputSchema.parse({ account: 'accounts/pub-1' })
    expect(parsed.date_range).toBe('LAST_7_DAYS')
    expect(parsed.dimensions).toEqual(['DATE'])
    expect(parsed.metrics).toContain('ESTIMATED_EARNINGS')
    expect(parsed.limit).toBe(100)
  })

  it('rejects a malformed start_date', () => {
    const r = adsenseReportInputSchema.safeParse({ account: 'a', start_date: '06/01/2026' })
    expect(r.success).toBe(false)
  })
})

describe('runAdsenseReport', () => {
  it('normalizes rows into name→value maps', async () => {
    mockGet.mockResolvedValueOnce(SAMPLE_REPORT as never)
    const result = await runAdsenseReport(adsenseReportInputSchema.parse({ account: 'accounts/pub-1' }))
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.headers).toEqual(['DATE', 'ESTIMATED_EARNINGS'])
      expect(result.rows[0]).toEqual({ DATE: '2026-06-01', ESTIMATED_EARNINGS: '1.23' })
      expect(result.totals.ESTIMATED_EARNINGS).toBe('1.23')
      expect(result.start_date).toBe('2026-06-01')
      expect(result.total_matched_rows).toBe(1)
    }
  })

  it('prefixes a bare account id with accounts/', async () => {
    mockGet.mockResolvedValueOnce(SAMPLE_REPORT as never)
    await runAdsenseReport(adsenseReportInputSchema.parse({ account: 'pub-1' }))
    expect(mockGet).toHaveBeenCalledWith('accounts/pub-1/reports:generate', expect.anything())
  })

  it('sends flattened date params for CUSTOM ranges', async () => {
    mockGet.mockResolvedValueOnce(SAMPLE_REPORT as never)
    await runAdsenseReport(
      adsenseReportInputSchema.parse({
        account: 'accounts/pub-1',
        date_range: 'CUSTOM',
        start_date: '2026-06-01',
        end_date: '2026-06-07',
      }),
    )
    const query = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(query).toMatchObject({
      dateRange: 'CUSTOM',
      'startDate.year': '2026',
      'startDate.month': '06',
      'startDate.day': '01',
      'endDate.day': '07',
    })
  })

  it('requires start/end when date_range is CUSTOM', async () => {
    const result = await runAdsenseReport(
      adsenseReportInputSchema.parse({ account: 'accounts/pub-1', date_range: 'CUSTOM' }),
    )
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('rejects explicit dates without a CUSTOM range', async () => {
    const result = await runAdsenseReport(
      adsenseReportInputSchema.parse({
        account: 'accounts/pub-1',
        date_range: 'LAST_30_DAYS',
        start_date: '2026-06-01',
        end_date: '2026-06-07',
      }),
    )
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
  })

  it('rejects start_date after end_date', async () => {
    const result = await runAdsenseReport(
      adsenseReportInputSchema.parse({
        account: 'accounts/pub-1',
        date_range: 'CUSTOM',
        start_date: '2026-06-07',
        end_date: '2026-06-01',
      }),
    )
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.INVALID_INPUT)
  })

  it('converts upstream ToolError into a failure result', async () => {
    mockGet.mockRejectedValueOnce(new ToolError(ErrorCode.QUOTA_EXCEEDED, 'slow down'))
    const result = await runAdsenseReport(adsenseReportInputSchema.parse({ account: 'accounts/pub-1' }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.QUOTA_EXCEEDED)
  })
})

describe('adsenseReportTool definition', () => {
  it('is read-only and requires account', () => {
    expect(adsenseReportTool.name).toBe('adsense_report')
    expect(adsenseReportTool.annotations.readOnlyHint).toBe(true)
    expect(adsenseReportTool.inputSchema.required).toContain('account')
  })
})
