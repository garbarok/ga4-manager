import { z } from 'zod'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'
import {
  ToolError,
  ErrorCode,
  errorResult,
  toolErrorToFailure,
  type ToolFailureResult,
} from '../utils/errors.js'
import { normalizeGa4Property } from '../utils/url-normalize.js'
import {
  computeConsentHealth,
  type ConsentReportRow,
  type ConsentHealthResult,
} from './compute-consent-health.js'

// ============================================================================
// Input Schema
// ============================================================================

export const ga4ConsentHealthInputSchema = z.object({
  property_id: z
    .string()
    .min(1, 'property_id is required')
    .describe(
      'GA4 Property ID: numeric (e.g. "123456789") or full form "properties/123456789". Not a Measurement ID (G-XXXXXX).',
    ),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .default(28)
    .describe('Look-back window in days (default: 28; max: 365), e.g. 28'),
  grant_event: z
    .string()
    .min(1, 'grant_event is required')
    .describe(
      'GA4 event name fired when user grants consent, e.g. "consent_granted"',
    ),
  deny_event: z
    .string()
    .min(1, 'deny_event is required')
    .describe(
      'GA4 event name fired when user denies consent, e.g. "consent_denied"',
    ),
  view_event: z
    .string()
    .min(1)
    .optional()
    .default('page_view')
    .describe(
      'Page/view event used as denominator for consent_visibility_pct (default: "page_view")',
    ),
})

export type Ga4ConsentHealthInput = z.infer<typeof ga4ConsentHealthInputSchema>

// ============================================================================
// Result Types
// ============================================================================

export type Ga4ConsentHealthSuccess = {
  success: true
  warnings: string[]
  property_id: string
  period: string
} & ConsentHealthResult

export type Ga4ConsentHealthError = ToolFailureResult

export type Ga4ConsentHealthResult =
  | Ga4ConsentHealthSuccess
  | Ga4ConsentHealthError

// ============================================================================
// Data API
// ============================================================================

interface DataApiResponse {
  rows?: ConsentReportRow[]
  error?: { code: number; message: string }
}

async function runDataApiReport(
  propertyId: string,
  body: Record<string, unknown>,
): Promise<ConsentReportRow[]> {
  const authHeaders = await getGoogleAuthHeaders([
    'https://www.googleapis.com/auth/analytics.readonly',
  ])

  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`

  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 403) {
      throw new ToolError(
        ErrorCode.AUTH_DENIED,
        `GA4 Data API access denied for ${propertyId} (HTTP 403)`,
        'Grant the service account Viewer role on the GA4 property. See mcp/PERMISSIONS.md.',
      )
    }
    if (response.status === 404) {
      throw new ToolError(
        ErrorCode.NOT_FOUND,
        `GA4 property not found: ${propertyId}`,
        'Verify the property ID in GA4 Admin → Property Settings.',
      )
    }
    throw new ToolError(
      ErrorCode.UPSTREAM_5XX,
      `GA4 Data API error (HTTP ${response.status}): ${text}`,
    )
  }

  const data = (await response.json()) as DataApiResponse
  return data.rows ?? []
}

// ============================================================================
// Handler
// ============================================================================

export async function runGa4ConsentHealth(
  input: Ga4ConsentHealthInput,
): Promise<Ga4ConsentHealthResult> {
  const { days, grant_event, deny_event, view_event } = input

  // Normalize property_id — throws ToolError for G-XXX, UA-XXX, etc.
  let propertyId: string
  try {
    propertyId = normalizeGa4Property(input.property_id)
  } catch (err) {
    if (err instanceof ToolError) {
      return toolErrorToFailure(err)
    }
    throw err
  }

  const period = `last ${days} days`

  try {
    const rows = await runDataApiReport(propertyId, {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: [grant_event, deny_event, view_event],
          },
        },
      },
    })

    const health = computeConsentHealth(rows, { grant_event, deny_event, view_event })

    const warnings = [...health.warnings]
    if (!health.available) {
      warnings.push(
        `No "${grant_event}" or "${deny_event}" events found in the last ${days} days. ` +
          'Instrument grant/deny events on banner accept/deny actions. See mcp/PERMISSIONS.md.',
      )
    }

    return {
      success: true,
      warnings,
      property_id: propertyId,
      period,
      events: health.events,
      consent_rate_pct: health.consent_rate_pct,
      consent_visibility_pct: health.consent_visibility_pct,
      health_score: health.health_score,
      available: health.available,
    }
  } catch (err) {
    if (err instanceof ToolError) {
      return toolErrorToFailure(err)
    }
    return errorResult(
      ErrorCode.UPSTREAM_5XX,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const ga4ConsentHealthTool = {
  name: 'ga4_consent_health',
  description:
    'Report GA4 consent banner health by counting `consent_granted` / `consent_denied` events vs page views. ' +
    'Use when traffic looks suspiciously low, after changing the cookie banner, or auditing privacy compliance. ' +
    'Requires the site to instrument grant/deny events on banner actions — ' +
    'Consent Mode v2 dimensions are NOT exposed on the Data API and not used here.',
  inputSchema: {
    type: 'object',
    required: ['property_id', 'grant_event', 'deny_event'],
    properties: {
      property_id: {
        type: 'string',
        description:
          'GA4 Property ID: numeric (e.g. "123456789") or "properties/123456789". Not a Measurement ID (G-XXXXXX).',
      },
      days: {
        type: 'number',
        description: 'Look-back window in days (default: 28; max: 365)',
        default: 28,
        minimum: 1,
        maximum: 365,
      },
      grant_event: {
        type: 'string',
        description: 'GA4 event fired on consent grant, e.g. "consent_granted"',
      },
      deny_event: {
        type: 'string',
        description: 'GA4 event fired on consent deny, e.g. "consent_denied"',
      },
      view_event: {
        type: 'string',
        description:
          'Page/view event as denominator for visibility ratio (default: "page_view")',
        default: 'page_view',
      },
    },
  },
  annotations: {
    title: 'GA4 consent-mode health',
    readOnlyHint: true,
  },
}
