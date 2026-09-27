import { getGoogleAuthHeaders } from './google-auth.js'
import { ToolError, ErrorCode, errorCodeForStatus } from './errors.js'

/**
 * Thin client for the GA4 Data API v1beta `runReport`, shared by every native
 * tool that reads report data (consent health, traffic report, growth brief).
 * Read-only: requests only the `analytics.readonly` scope.
 *
 * @see https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
 */

const DATA_API_BASE = 'https://analyticsdata.googleapis.com/v1beta'

export const ANALYTICS_READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

export interface DataApiRow {
  dimensionValues: { value: string }[]
  metricValues: { value: string }[]
}

export interface DataApiResponse {
  dimensionHeaders?: { name: string }[]
  metricHeaders?: { name: string; type?: string }[]
  rows?: DataApiRow[]
  totals?: DataApiRow[]
  rowCount?: number
}

/**
 * POST a `runReport` body for `propertyId` ("properties/N") and return the
 * parsed response. Throws a {@link ToolError} on HTTP failure so callers can
 * convert it with `toolErrorToFailure`.
 */
export async function runReport(
  propertyId: string,
  body: Record<string, unknown>,
): Promise<DataApiResponse> {
  const authHeaders = await getGoogleAuthHeaders([ANALYTICS_READONLY_SCOPE])

  const response = await fetch(`${DATA_API_BASE}/${propertyId}:runReport`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw mapDataApiError(propertyId, response.status, await response.text())
  }

  return (await response.json()) as DataApiResponse
}

function mapDataApiError(propertyId: string, status: number, body: string): ToolError {
  if (status === 401 || status === 403) {
    return new ToolError(
      ErrorCode.AUTH_DENIED,
      `GA4 Data API access denied for ${propertyId} (HTTP ${status})`,
      'Grant the credential Viewer role on the GA4 property. See mcp/PERMISSIONS.md.',
    )
  }
  if (status === 404) {
    return new ToolError(
      ErrorCode.NOT_FOUND,
      `GA4 property not found: ${propertyId}`,
      'Verify the property ID in GA4 Admin → Property Settings.',
    )
  }
  return new ToolError(errorCodeForStatus(status), `GA4 Data API error (HTTP ${status}): ${body}`)
}
