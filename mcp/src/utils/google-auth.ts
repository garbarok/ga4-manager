import { readFile } from 'fs/promises'
import { createSign } from 'crypto'
import { ToolError, ErrorCode } from './errors.js'

/**
 * Headers returned by getGoogleAuthHeaders. Always includes Authorization.
 * For ADC user credentials with a quota_project_id, also includes
 * X-Goog-User-Project so the API call bills the right project.
 */
export type AuthHeaders = {
  Authorization: string
} & {
  [k: string]: string
}

/**
 * Service account credentials JSON structure.
 * `type: "service_account"`.
 */
interface ServiceAccountCredentials {
  type: 'service_account'
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
}

/**
 * ADC user credentials JSON structure (from `gcloud auth application-default login`).
 * `type: "authorized_user"`.
 */
interface AuthorizedUserCredentials {
  type: 'authorized_user'
  client_id: string
  client_secret: string
  refresh_token: string
  quota_project_id?: string
  token_uri?: string
}

type AnyCredentials = ServiceAccountCredentials | AuthorizedUserCredentials

/**
 * Cached token entry
 */
interface CachedToken {
  headers: AuthHeaders
  expiresAt: number // Unix timestamp ms
}

// In-memory token cache keyed by scope string
const tokenCache = new Map<string, CachedToken>()

/**
 * Sign a JWT claim set using RS256
 */
function signJwt(header: object, claimSet: object, privateKey: string): string {
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const unsignedToken = `${encode(header)}.${encode(claimSet)}`

  const sign = createSign('RSA-SHA256')
  sign.update(unsignedToken)
  const signature = sign.sign(privateKey, 'base64url')

  return `${unsignedToken}.${signature}`
}

/**
 * Exchange a signed JWT assertion for an OAuth2 access token (service account).
 */
async function exchangeJwtForToken(
  jwt: string,
  tokenUri: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to obtain access token (HTTP ${response.status}): ${text}`,
    )
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }
  return data
}

/**
 * Mint an access token from a service account using JWT bearer flow.
 */
async function authFromServiceAccount(
  creds: ServiceAccountCredentials,
  scopes: string[],
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!creds.private_key || !creds.client_email) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'Service account credentials are missing private_key or client_email fields.',
      'Re-download the JSON key from Google Cloud Console → IAM → Service Accounts → Keys.',
    )
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600

  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: creds.client_email,
    scope: scopes.join(' '),
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: expiresAt,
  }

  const jwt = signJwt(header, claimSet, creds.private_key)
  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token'
  const tokenResponse = await exchangeJwtForToken(jwt, tokenUri)

  return {
    accessToken: tokenResponse.access_token,
    expiresIn: tokenResponse.expires_in,
  }
}

/**
 * Mint an access token from ADC user credentials by exchanging the refresh token.
 *
 * Note: the access token's scopes are determined by the refresh token's grant
 * (set during `gcloud auth application-default login --scopes=...`), NOT by
 * the `scopes` argument. If the user did not consent the required scope at
 * login time, the API call will fail with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
 * The fix is to re-run the login with the correct scopes (see TROUBLESHOOTING.md).
 */
async function authFromAuthorizedUser(
  creds: AuthorizedUserCredentials,
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!creds.refresh_token || !creds.client_id || !creds.client_secret) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'ADC user credentials missing refresh_token, client_id, or client_secret.',
      'Re-run: gcloud auth application-default login --scopes=...',
    )
  }

  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token'

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  })

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      `Failed to refresh ADC user credentials (HTTP ${response.status}): ${text}`,
      'Re-run: gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/userinfo.email',
    )
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

/**
 * Obtain Google OAuth2 authorization headers for the requested scopes.
 *
 * Reads credentials at GOOGLE_APPLICATION_CREDENTIALS, supports two formats:
 *
 *  - Service account key (`type: "service_account"`): mints a JWT, exchanges
 *    for an access token with the requested scopes.
 *
 *  - ADC user credentials (`type: "authorized_user"`): refreshes the user's
 *    refresh token. Scopes are fixed at gcloud-login time, not per-call.
 *    Adds X-Goog-User-Project header from `quota_project_id` so the API call
 *    bills the right project (avoids SERVICE_DISABLED errors on user creds).
 *
 * Caches the headers per-scope-set until 5 minutes before expiry.
 *
 * @param scopes - OAuth2 scopes to request (only used for service accounts)
 * @returns Headers object: { Authorization, [X-Goog-User-Project]? }
 * @throws ToolError if credentials are missing, invalid, or token exchange fails
 */
export async function getGoogleAuthHeaders(
  scopes: string[],
): Promise<AuthHeaders> {
  const cacheKey = scopes.slice().sort().join(' ')
  const now = Date.now()

  // Return cached token if still valid (with 5-min buffer)
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
    return cached.headers
  }

  // Resolve credentials path
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.',
      'Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key OR an ADC file (~/.config/gcloud/application_default_credentials.json). Run ./scripts/setup.sh for guided setup.',
    )
  }

  // Load credentials
  let creds: AnyCredentials
  try {
    const raw = await readFile(credPath, 'utf-8')
    creds = JSON.parse(raw) as AnyCredentials
  } catch (err) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      `Failed to load credentials from ${credPath}: ${err instanceof Error ? err.message : String(err)}`,
      'Verify GOOGLE_APPLICATION_CREDENTIALS points to a readable JSON file.',
    )
  }

  let accessToken: string
  let expiresIn: number
  let quotaProject: string | undefined

  switch (creds.type) {
    case 'service_account': {
      const result = await authFromServiceAccount(creds, scopes)
      accessToken = result.accessToken
      expiresIn = result.expiresIn
      break
    }
    case 'authorized_user': {
      const result = await authFromAuthorizedUser(creds)
      accessToken = result.accessToken
      expiresIn = result.expiresIn
      quotaProject = creds.quota_project_id
      break
    }
    default: {
      const t = (creds as { type?: unknown }).type
      throw new ToolError(
        ErrorCode.AUTH_DENIED,
        `Unsupported credentials type "${String(t)}". Expected "service_account" or "authorized_user".`,
        'Use a service account JSON key OR run: gcloud auth application-default login --scopes=... See mcp/PERMISSIONS.md.',
      )
    }
  }

  const headers: AuthHeaders = { Authorization: `Bearer ${accessToken}` }
  if (quotaProject) {
    headers['X-Goog-User-Project'] = quotaProject
  }

  // Cache the full headers (incl. quota project) for the next call
  const expiresAtMs = now + expiresIn * 1000
  tokenCache.set(cacheKey, { headers, expiresAt: expiresAtMs })

  return headers
}

/**
 * Clear the in-memory token cache. Useful for testing.
 */
export function clearTokenCache(): void {
  tokenCache.clear()
}
