import { getGoogleAuthHeaders } from './google-auth.js'
import { ToolError, ErrorCode } from './errors.js'

/**
 * Thin client for the AdSense Management API v2 (publisher reporting).
 *
 * Unlike Google Ads (advertiser side), AdSense needs no developer token and no
 * Manager account — it is a plain read-only REST API authorized with the
 * `adsense.readonly` OAuth scope. We reuse the same credential resolution as the
 * GSC/GA4 native tools (`getGoogleAuthHeaders`), so the existing
 * GOOGLE_APPLICATION_CREDENTIALS (service-account key or ADC user file) works
 * here too — provided the `adsense.readonly` scope was consented at login time.
 *
 * @see https://developers.google.com/adsense/management/reference/rest
 */

const ADSENSE_BASE = 'https://adsense.googleapis.com/v2'

/** Read-only AdSense scope. Mirrors the per-API scope pattern of the GSC tools. */
export const ADSENSE_READONLY_SCOPE = 'https://www.googleapis.com/auth/adsense.readonly'

/**
 * Perform an authorized GET against the AdSense Management API and parse JSON.
 *
 * `path` is the part after the version segment, e.g. "accounts" or
 * "accounts/pub-123/reports:generate". `query` entries with `undefined` values
 * are dropped; array values are appended as repeated params (the AdSense API
 * expects repeated `metrics`/`dimensions` rather than comma-joined lists).
 *
 * Throws a {@link ToolError} with a structured code on known HTTP failures so
 * callers can convert it via `toolErrorToFailure` in their catch block.
 */
export async function adsenseGet<T>(
  path: string,
  query: Record<string, string | string[] | undefined> = {},
): Promise<T> {
  const headers = await getGoogleAuthHeaders([ADSENSE_READONLY_SCOPE])

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v)
    } else {
      params.append(key, value)
    }
  }

  const qs = params.toString()
  const url = `${ADSENSE_BASE}/${path}${qs ? `?${qs}` : ''}`

  const response = await fetch(url, { method: 'GET', headers })

  if (!response.ok) {
    const text = await response.text()
    throw mapAdsenseError(response.status, text)
  }

  return (await response.json()) as T
}

/** Map an AdSense HTTP error to a structured {@link ToolError}. */
function mapAdsenseError(status: number, body: string): ToolError {
  if (status === 401) {
    return new ToolError(
      ErrorCode.AUTH_DENIED,
      'AdSense authentication failed (HTTP 401)',
      'Token expired or missing the adsense.readonly scope. Re-run: gcloud auth application-default login --scopes=...,https://www.googleapis.com/auth/adsense.readonly',
    )
  }
  if (status === 403) {
    return new ToolError(
      ErrorCode.AUTH_DENIED,
      `AdSense access denied (HTTP 403): ${body}`,
      'The authenticated identity must own (or be granted access to) the AdSense account, and the AdSense Management API must be enabled in the Cloud project. Note: service-account keys cannot access a personal AdSense account — use ADC user credentials.',
    )
  }
  if (status === 404) {
    return new ToolError(
      ErrorCode.NOT_FOUND,
      `AdSense resource not found (HTTP 404): ${body}`,
      'Check the account name (accounts/pub-XXXXXXXXXXXXXXXX) — list it with adsense_accounts_list first.',
    )
  }
  if (status === 429) {
    return new ToolError(
      ErrorCode.QUOTA_EXCEEDED,
      'AdSense quota exceeded (HTTP 429)',
      'Back off and retry later; AdSense enforces per-minute and per-day request quotas.',
    )
  }
  return new ToolError(
    ErrorCode.UPSTREAM_5XX,
    `AdSense API error (HTTP ${status}): ${body}`,
  )
}
