import { readFile } from 'fs/promises'
import { createSign } from 'crypto'
import { ToolError, ErrorCode } from './errors.js'

/**
 * Service account credentials JSON structure
 */
interface ServiceAccountCredentials {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
}

/**
 * Cached token entry
 */
interface CachedToken {
  accessToken: string
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
 * Exchange a signed JWT assertion for an OAuth2 access token
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
 * Obtain Google OAuth2 authorization headers for the requested scopes.
 *
 * Reads the service account key at GOOGLE_APPLICATION_CREDENTIALS, mints a
 * short-lived JWT, exchanges it for an access token, caches the token until
 * 5 minutes before expiry, and returns the Authorization header value.
 *
 * @param scopes - OAuth2 scopes to request (e.g. ["https://www.googleapis.com/auth/webmasters.readonly"])
 * @returns Object with Authorization header ready for use
 * @throws If credentials are missing, invalid, or the token exchange fails
 */
export async function getGoogleAuthHeaders(
  scopes: string[],
): Promise<{ Authorization: string }> {
  const cacheKey = scopes.slice().sort().join(' ')
  const now = Date.now()

  // Return cached token if still valid (with 5-min buffer)
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt - now > 5 * 60 * 1000) {
    return { Authorization: `Bearer ${cached.accessToken}` }
  }

  // Resolve credentials path
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.',
      'Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON key file.',
    )
  }

  // Load credentials
  let creds: ServiceAccountCredentials
  try {
    const raw = await readFile(credPath, 'utf-8')
    creds = JSON.parse(raw) as ServiceAccountCredentials
  } catch (err) {
    throw new Error(
      `Failed to load service account credentials from ${credPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (creds.type !== 'service_account') {
    throw new Error(
      `Invalid credentials type "${creds.type}" — expected "service_account". ` +
        'Ensure GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON key.',
    )
  }

  if (!creds.private_key || !creds.client_email) {
    throw new Error(
      'Service account credentials are missing private_key or client_email fields.',
    )
  }

  // Build JWT claim set
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600 // 1 hour

  const header = { alg: 'RS256', typ: 'JWT' }
  const claimSet = {
    iss: creds.client_email,
    scope: scopes.join(' '),
    aud: creds.token_uri || 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: expiresAt,
  }

  const jwt = signJwt(header, claimSet, creds.private_key)

  // Exchange for access token
  const tokenUri =
    creds.token_uri || 'https://oauth2.googleapis.com/token'
  const tokenResponse = await exchangeJwtForToken(jwt, tokenUri)

  // Cache the token
  const expiresAtMs = now + tokenResponse.expires_in * 1000
  tokenCache.set(cacheKey, {
    accessToken: tokenResponse.access_token,
    expiresAt: expiresAtMs,
  })

  return { Authorization: `Bearer ${tokenResponse.access_token}` }
}

/**
 * Clear the in-memory token cache. Useful for testing.
 */
export function clearTokenCache(): void {
  tokenCache.clear()
}
