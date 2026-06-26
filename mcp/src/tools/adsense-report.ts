import { z } from 'zod'
import { native } from '../tool-spec.js'
import { adsenseGet } from '../utils/adsense-client.js'
import {
  ToolError,
  toolErrorToFailure,
  errorResult,
  ErrorCode,
  type ToolFailureResult,
} from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

const DATE_RANGES = [
  'CUSTOM',
  'TODAY',
  'YESTERDAY',
  'MONTH_TO_DATE',
  'YEAR_TO_DATE',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_MONTH',
  'LAST_3_MONTHS',
  'LAST_6_MONTHS',
  'LAST_12_MONTHS',
  'LAST_YEAR',
] as const

// Defaults are chosen to answer the most common question — "how much did I earn
// recently, by day" — with one call. Metrics/dimensions are free strings (not a
// closed enum) because the AdSense enum is large and Google extends it; we
// document the common ones in the tool description instead of pinning them here.
const DEFAULT_METRICS = ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'IMPRESSIONS', 'CLICKS', 'IMPRESSIONS_RPM']
const DEFAULT_DIMENSIONS = ['DATE']

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export const adsenseReportInputSchema = z.object({
  account: z
    .string()
    .min(1, 'account is required')
    .describe('AdSense account name from adsense_accounts_list, e.g. "accounts/pub-1234567890123456"'),
  date_range: z
    .enum(DATE_RANGES)
    .optional()
    .default('LAST_7_DAYS')
    .describe('Preset range (default LAST_7_DAYS). Use "CUSTOM" with start_date/end_date for an explicit window.'),
  start_date: dateString.optional().describe('Start date YYYY-MM-DD (required when date_range is CUSTOM)'),
  end_date: dateString.optional().describe('End date YYYY-MM-DD (required when date_range is CUSTOM)'),
  metrics: z
    .array(z.string())
    .optional()
    .default(DEFAULT_METRICS)
    .describe(
      'AdSense metric enum names (default: ESTIMATED_EARNINGS, PAGE_VIEWS, IMPRESSIONS, CLICKS, IMPRESSIONS_RPM). ' +
        'Others: AD_REQUESTS, MATCHED_AD_REQUESTS, PAGE_VIEWS_RPM, IMPRESSIONS_CTR, COST_PER_CLICK, ACTIVE_VIEW_VIEWABILITY.',
    ),
  dimensions: z
    .array(z.string())
    .optional()
    .default(DEFAULT_DIMENSIONS)
    .describe(
      'AdSense dimension enum names to break down by (default: DATE). ' +
        'Others: MONTH, WEEK, DOMAIN_NAME, COUNTRY_NAME, AD_UNIT_NAME, PLATFORM_TYPE_NAME, AD_FORMAT_NAME.',
    ),
  currency_code: z
    .string()
    .optional()
    .describe('ISO-4217 currency for earnings, e.g. "USD". Defaults to the account currency.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(100)
    .describe('Max rows to return (default 100, max 1000 here).'),
})

export type AdsenseReportInput = z.infer<typeof adsenseReportInputSchema>

// ============================================================================
// AdSense ReportResult types (subset) + normalized output
// ============================================================================

interface ReportHeader {
  name: string
  type?: string
  currencyCode?: string
}
interface ReportCell {
  value?: string
}
interface ReportRow {
  cells?: ReportCell[]
}
interface ReportResult {
  headers?: ReportHeader[]
  rows?: ReportRow[]
  totals?: ReportRow
  averages?: ReportRow
  warnings?: string[]
  totalMatchedRows?: string
  startDate?: { year: number; month: number; day: number }
  endDate?: { year: number; month: number; day: number }
}

export type AdsenseReportResult =
  | {
      success: true
      account: string
      date_range: string
      start_date?: string
      end_date?: string
      headers: string[]
      /** Each row as a { headerName: value } map — easier for the model to read than positional cells. */
      rows: Record<string, string>[]
      totals: Record<string, string>
      total_matched_rows?: number
      warnings: string[]
    }
  | ToolFailureResult

// ============================================================================
// Helpers
// ============================================================================

/** Turn "2026-06-01" into the three flattened query params AdSense expects. */
function dateParams(prefix: 'startDate' | 'endDate', ymd: string): Record<string, string> {
  const [year, month, day] = ymd.split('-')
  return { [`${prefix}.year`]: year, [`${prefix}.month`]: month, [`${prefix}.day`]: day }
}

/** Zip a ReportResult row's positional cells against the headers into a name→value map. */
function rowToObject(headers: ReportHeader[], row: ReportRow | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!row?.cells) return out
  headers.forEach((h, i) => {
    out[h.name] = row.cells?.[i]?.value ?? ''
  })
  return out
}

function formatDate(d?: { year: number; month: number; day: number }): string | undefined {
  if (!d) return undefined
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${d.year}-${mm}-${dd}`
}

// ============================================================================
// Handler
// ============================================================================

export async function runAdsenseReport(input: AdsenseReportInput): Promise<AdsenseReportResult> {
  const { account, date_range, start_date, end_date, metrics, dimensions, currency_code, limit } = input

  // CUSTOM requires an explicit window; presets must NOT carry one (AdSense
  // rejects start/end dates alongside a named range).
  if (date_range === 'CUSTOM') {
    if (!start_date || !end_date) {
      return errorResult(
        ErrorCode.INVALID_INPUT,
        'date_range "CUSTOM" requires both start_date and end_date (YYYY-MM-DD).',
        'Provide start_date and end_date, or pick a preset like LAST_30_DAYS.',
      )
    }
    if (start_date > end_date) {
      return errorResult(
        ErrorCode.INVALID_INPUT,
        `start_date (${start_date}) is after end_date (${end_date}).`,
        'Ensure start_date <= end_date.',
      )
    }
  } else if (start_date || end_date) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      `start_date/end_date are only valid with date_range "CUSTOM" (got "${date_range}").`,
      'Set date_range to "CUSTOM" to use an explicit window, or drop the dates.',
    )
  }

  if (metrics.length === 0) {
    return errorResult(ErrorCode.INVALID_INPUT, 'At least one metric is required.')
  }

  const accountPath = account.startsWith('accounts/') ? account : `accounts/${account}`

  const query: Record<string, string | string[] | undefined> = {
    dateRange: date_range,
    metrics,
    dimensions: dimensions.length > 0 ? dimensions : undefined,
    currencyCode: currency_code,
    limit: String(limit),
    ...(date_range === 'CUSTOM'
      ? { ...dateParams('startDate', start_date!), ...dateParams('endDate', end_date!) }
      : {}),
  }

  try {
    const data = await adsenseGet<ReportResult>(`${accountPath}/reports:generate`, query)

    const headers = data.headers ?? []
    return {
      success: true,
      account: accountPath,
      date_range,
      start_date: formatDate(data.startDate),
      end_date: formatDate(data.endDate),
      headers: headers.map((h) => h.name),
      rows: (data.rows ?? []).map((r) => rowToObject(headers, r)),
      totals: rowToObject(headers, data.totals),
      total_matched_rows: data.totalMatchedRows ? Number(data.totalMatchedRows) : undefined,
      warnings: data.warnings ?? [],
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const adsenseReportTool = {
  name: 'adsense_report',
  description:
    'Use when the user asks how much they earn from AdSense ads on their own site, ' +
    'or wants a breakdown of earnings/page views/impressions/clicks/RPM. ' +
    'Generates an AdSense Management API report for one account. ' +
    'Get the account name from adsense_accounts_list first. ' +
    'Defaults: last 7 days, metrics [ESTIMATED_EARNINGS, PAGE_VIEWS, IMPRESSIONS, CLICKS, IMPRESSIONS_RPM], broken down by DATE. ' +
    'Use date_range="CUSTOM" with start_date/end_date for an explicit window. ' +
    'Returns rows as name→value maps plus totals. Read-only.',
  inputSchema: {
    type: 'object',
    required: ['account'],
    properties: {
      account: {
        type: 'string',
        description: 'AdSense account name from adsense_accounts_list, e.g. "accounts/pub-1234567890123456"',
      },
      date_range: {
        type: 'string',
        enum: [...DATE_RANGES],
        description: 'Preset range (default LAST_7_DAYS). Use "CUSTOM" with start_date/end_date for an explicit window.',
        default: 'LAST_7_DAYS',
      },
      start_date: { type: 'string', description: 'Start date YYYY-MM-DD (required when date_range is CUSTOM)' },
      end_date: { type: 'string', description: 'End date YYYY-MM-DD (required when date_range is CUSTOM)' },
      metrics: {
        type: 'array',
        items: { type: 'string' },
        description:
          'AdSense metric enum names (default: ESTIMATED_EARNINGS, PAGE_VIEWS, IMPRESSIONS, CLICKS, IMPRESSIONS_RPM)',
        default: DEFAULT_METRICS,
      },
      dimensions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dimensions to break down by (default: ["DATE"]). e.g. DOMAIN_NAME, COUNTRY_NAME, AD_UNIT_NAME',
        default: DEFAULT_DIMENSIONS,
      },
      currency_code: {
        type: 'string',
        description: 'ISO-4217 currency for earnings, e.g. "USD". Defaults to the account currency.',
      },
      limit: {
        type: 'number',
        description: 'Max rows to return (default 100, max 1000)',
        default: 100,
        minimum: 1,
        maximum: 1000,
      },
    },
  },
  annotations: { title: 'Generate AdSense report', readOnlyHint: true },
}

export const adsenseReportSpec = native({
  tool: adsenseReportTool,
  schema: adsenseReportInputSchema,
  run: async (input) => {
    const output = await runAdsenseReport(input)
    return { output, isError: !output.success }
  },
})
