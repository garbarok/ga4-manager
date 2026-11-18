import { getGoogleAuthHeaders } from './google-auth.js'
import { ANALYTICS_READONLY_SCOPE } from './ga4-data-client.js'
import { ToolError, errorCodeForStatus } from './errors.js'

/**
 * Read-only GA4 Admin API lookup of a property's settings (time zone,
 * currency, display name). Needs only analytics.readonly and Viewer access.
 *
 * @see https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties/get
 */

const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta'

export interface Ga4PropertySettings {
  name: string
  display_name: string | null
  time_zone: string | null
  currency_code: string | null
  create_time: string | null
}

export async function getPropertySettings(propertyId: string): Promise<Ga4PropertySettings> {
  const headers = await getGoogleAuthHeaders([ANALYTICS_READONLY_SCOPE])
  const res = await fetch(`${ADMIN_BASE}/${propertyId}`, { headers })
  if (!res.ok) {
    throw new ToolError(
      errorCodeForStatus(res.status),
      `GA4 Admin API error reading ${propertyId} (HTTP ${res.status}): ${await res.text()}`,
      'Grant the credential Viewer on the property and enable analyticsadmin.googleapis.com.',
    )
  }
  const p = (await res.json()) as { name?: string; displayName?: string; timeZone?: string; currencyCode?: string; createTime?: string }
  return {
    name: p.name ?? propertyId,
    display_name: p.displayName ?? null,
    time_zone: p.timeZone ?? null,
    currency_code: p.currencyCode ?? null,
    create_time: p.createTime ?? null,
  }
}

/** Search Console reports dates in Pacific Time. */
export const GSC_TIME_ZONE = 'America/Los_Angeles'
