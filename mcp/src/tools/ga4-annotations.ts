import { z } from 'zod'
import { native } from '../tool-spec.js'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import {
  ToolError,
  ErrorCode,
  errorCodeForStatus,
  errorResult,
  toolErrorToFailure,
  type ToolFailureResult,
} from '../utils/errors.js'
import { normalizeGa4Property } from '../utils/url-normalize.js'

// ============================================================================
// Constants
// ============================================================================

// reportingDataAnnotations only exists on v1alpha of the Admin API.
// @see https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.reportingDataAnnotations
const ADMIN_ALPHA_BASE = 'https://analyticsadmin.googleapis.com/v1alpha'

// Scope split per docs/adr/0004-analytics-edit-scope.md: list accepts readonly,
// create needs edit.
const READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const EDIT_SCOPE = 'https://www.googleapis.com/auth/analytics.edit'

/** ORANGE is reserved for system-generated annotations, so it is not creatable. */
const CREATE_COLORS = ['PURPLE', 'BROWN', 'BLUE', 'GREEN', 'RED', 'CYAN'] as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ============================================================================
// Input Schema
// ============================================================================

const isoDate = (what: string) =>
  z
    .string()
    .regex(DATE_RE, `${what} must be YYYY-MM-DD`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
    }, `${what} is not a real calendar date`)

export const ga4AnnotationsInputSchema = z
  .object({
    property: z
      .string()
      .min(1, 'property is required')
      .describe(
        'GA4 Property ID: numeric (e.g. "123456789") or "properties/123456789". Not a Measurement ID (G-XXXXXX).',
      ),
    action: z
      .enum(['list', 'create'])
      .optional()
      .default('list')
      .describe('"list" (default) returns existing annotations; "create" adds one'),
    since: isoDate('since')
      .optional()
      .describe('list only: keep annotations on or after this date (YYYY-MM-DD), e.g. "2026-09-01"'),
    title: z
      .string()
      .min(1)
      .max(60, 'title must be at most 60 characters (GA4 limit)')
      .optional()
      .describe('create only (required): short label, e.g. "Rewrote /pricing title"'),
    description: z
      .string()
      .max(150, 'description must be at most 150 characters (GA4 limit)')
      .optional()
      .describe('create only: short note (max 150 chars) on what changed and why'),
    date: isoDate('date').optional().describe('create only: single-day annotation (YYYY-MM-DD)'),
    date_range: z
      .object({ start: isoDate('date_range.start'), end: isoDate('date_range.end') })
      .optional()
      .describe('create only: inclusive range {start, end} (YYYY-MM-DD); alternative to date'),
    color: z.enum(CREATE_COLORS).optional().describe('create only: annotation color (default BLUE)'),
  })
  .superRefine((v, ctx) => {
    if (v.action !== 'create') return
    if (!v.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'title is required for create' })
    }
    if (!v.date && !v.date_range) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'create needs date or date_range' })
    }
    if (v.date && v.date_range) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'pass date or date_range, not both' })
    }
    if (v.date_range && v.date_range.end < v.date_range.start) {
      ctx.addIssue({
        code: 'custom',
        path: ['date_range'],
        message: 'date_range.end must be on or after date_range.start',
      })
    }
  })

export type Ga4AnnotationsInput = z.infer<typeof ga4AnnotationsInputSchema>

// ============================================================================
// Types (subset of the ReportingDataAnnotation resource we surface)
// ============================================================================

interface ApiDate {
  year: number
  month: number
  day: number
}

export interface ReportingDataAnnotation {
  /** properties/{property}/reportingDataAnnotations/{id} */
  name: string
  title: string
  description?: string
  color?: string
  systemGenerated?: boolean
  annotationDate?: ApiDate
  annotationDateRange?: { startDate: ApiDate; endDate: ApiDate }
}

interface ListResponse {
  reportingDataAnnotations?: ReportingDataAnnotation[]
  nextPageToken?: string
}

export type Ga4AnnotationsResult =
  | {
      success: true
      action: 'list'
      property: string
      count: number
      annotations: ReportingDataAnnotation[]
    }
  | { success: true; action: 'create'; property: string; annotation: ReportingDataAnnotation }
  | ToolFailureResult

// ============================================================================
// Helpers
// ============================================================================

function toApiDate(iso: string): ApiDate {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function fromApiDate(d: ApiDate): string {
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/** Last day an annotation covers (its date, or the end of its range). */
function lastDay(a: ReportingDataAnnotation): string | undefined {
  if (a.annotationDate) return fromApiDate(a.annotationDate)
  if (a.annotationDateRange) return fromApiDate(a.annotationDateRange.endDate)
  return undefined
}

function mapHttpError(status: number, body: string, forCreate: boolean): ToolError {
  if (status === 403 && forCreate) {
    return new ToolError(
      ErrorCode.AUTH_DENIED,
      `GA4 denied creating the annotation (HTTP 403): ${body}`,
      'Creating annotations needs the analytics.edit scope on the credential (re-run gcloud auth application-default login with it; see docs/adr/0004-analytics-edit-scope.md) and an Editor or higher role on the property.',
    )
  }
  if (status === 401 || status === 403) {
    return new ToolError(
      ErrorCode.AUTH_DENIED,
      `GA4 access denied (HTTP ${status}): ${body}`,
      'Check the credential has the analytics.readonly scope and Viewer access to the property, and that analyticsadmin.googleapis.com is enabled.',
    )
  }
  return new ToolError(errorCodeForStatus(status), `GA4 Admin API error (HTTP ${status}): ${body}`)
}

// ============================================================================
// Handler
// ============================================================================

async function listAnnotations(property: string, since?: string): Promise<Ga4AnnotationsResult> {
  const headers = await getGoogleAuthHeaders([READONLY_SCOPE])
  const all: ReportingDataAnnotation[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '200' })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(
      `${ADMIN_ALPHA_BASE}/${property}/reportingDataAnnotations?${params}`,
      { method: 'GET', headers },
    )
    if (!response.ok) throw mapHttpError(response.status, await response.text(), false)
    const data = (await response.json()) as ListResponse
    if (data.reportingDataAnnotations) all.push(...data.reportingDataAnnotations)
    pageToken = data.nextPageToken
  } while (pageToken)

  // `since` is applied client-side: the API filter syntax has no documented
  // date-comparison example. An annotation is kept when it ends on/after `since`.
  const annotations = since
    ? all.filter((a) => {
        const end = lastDay(a)
        return end !== undefined && end >= since
      })
    : all

  return { success: true, action: 'list', property, count: annotations.length, annotations }
}

async function createAnnotation(
  property: string,
  input: Ga4AnnotationsInput,
): Promise<Ga4AnnotationsResult> {
  const headers = await getGoogleAuthHeaders([EDIT_SCOPE])
  const body: Record<string, unknown> = {
    title: input.title,
    color: input.color ?? 'BLUE',
    ...(input.description ? { description: input.description } : {}),
    ...(input.date
      ? { annotationDate: toApiDate(input.date) }
      : {
          annotationDateRange: {
            startDate: toApiDate(input.date_range!.start),
            endDate: toApiDate(input.date_range!.end),
          },
        }),
  }

  const response = await fetch(`${ADMIN_ALPHA_BASE}/${property}/reportingDataAnnotations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw mapHttpError(response.status, await response.text(), true)

  const annotation = (await response.json()) as ReportingDataAnnotation
  return { success: true, action: 'create', property, annotation }
}

/** List or create GA4 reporting-data annotations (the SEO decision log). */
export async function runGa4Annotations(input: Ga4AnnotationsInput): Promise<Ga4AnnotationsResult> {
  try {
    const property = normalizeGa4Property(input.property)
    return input.action === 'create'
      ? await createAnnotation(property, input)
      : await listAnnotations(property, input.since)
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const ga4AnnotationsTool = {
  name: 'ga4_annotations',
  description:
    'Use to record SEO decisions (title change, content refresh, consolidation, redirect) as GA4 annotations ' +
    'so later before/after comparisons have a date, and to list that decision log. ' +
    'action "list" (default) returns annotations, optionally only those on or after `since`; ' +
    'action "create" adds one (title + date or date_range, optional description and color). ' +
    'Create needs the analytics.edit scope and Editor role; list needs only analytics.readonly. ' +
    'Uses the Admin API v1alpha. Never edits or deletes existing annotations.',
  inputSchema: {
    type: 'object',
    properties: {
      property: {
        type: 'string',
        description:
          'GA4 Property ID: numeric (e.g. "123456789") or "properties/123456789". Not a Measurement ID (G-XXXXXX).',
      },
      action: {
        type: 'string',
        enum: ['list', 'create'],
        description: '"list" (default) or "create"',
      },
      since: {
        type: 'string',
        description: 'list only: keep annotations on or after this date (YYYY-MM-DD)',
      },
      title: { type: 'string', maxLength: 60, description: 'create only (required): short label (max 60 chars)' },
      description: {
        type: 'string',
        maxLength: 150,
        description: 'create only: short note (max 150 chars) on what changed and why',
      },
      date: { type: 'string', description: 'create only: single day (YYYY-MM-DD)' },
      date_range: {
        type: 'object',
        description: 'create only: inclusive range, alternative to date',
        properties: {
          start: { type: 'string', description: 'YYYY-MM-DD' },
          end: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['start', 'end'],
      },
      color: {
        type: 'string',
        enum: [...CREATE_COLORS],
        description: 'create only: annotation color (default BLUE)',
      },
    },
    required: ['property'],
  },
  annotations: {
    title: 'GA4 annotations (SEO decision log)',
    readOnlyHint: false,
    destructiveHint: false,
  },
}

export const ga4AnnotationsSpec = native({
  tool: ga4AnnotationsTool,
  schema: ga4AnnotationsInputSchema,
  run: async (input) => {
    const output = await runGa4Annotations(input)
    return { output, isError: !output.success }
  },
})
