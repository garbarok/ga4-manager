import { ToolError, ErrorCode, errorCodeForStatus } from './errors.js'

/**
 * Thin client for the DataForSEO v3 API (keyword volume, SERP snapshots).
 * Auth is HTTP Basic with a login/password pair from the DataForSEO dashboard
 * (not OAuth), read from DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD.
 *
 * @see https://docs.dataforseo.com/v3/
 */

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

export interface DataforseoCredentials {
  username?: string
  password?: string
}

interface DataforseoTask<R> {
  status_code: number
  status_message: string
  result?: R[] | null
}

interface DataforseoResponse<R> {
  status_code: number
  status_message: string
  tasks?: DataforseoTask<R>[] | null
}

function resolveCredentials(creds: DataforseoCredentials): { username: string; password: string } {
  const username = creds.username ?? (process.env.DATAFORSEO_USERNAME || undefined)
  const password = creds.password ?? (process.env.DATAFORSEO_PASSWORD || undefined)
  if (!username || !password) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'This tool requires DataForSEO credentials.',
      'Set DATAFORSEO_USERNAME and DATAFORSEO_PASSWORD (env vars) — see mcp/PERMISSIONS.md#dataforseo',
    )
  }
  return { username, password }
}

/**
 * POST one task to a DataForSEO "live" endpoint and return its first result array.
 * `path` is the part after `/v3/`, e.g. "keywords_data/google_ads/search_volume/live".
 * `task` is the single task object DataForSEO expects wrapped in an array body.
 */
export async function dataforseoPost<R>(
  path: string,
  task: Record<string, unknown>,
  creds: DataforseoCredentials = {},
): Promise<R[]> {
  const { username, password } = resolveCredentials(creds)
  const auth = Buffer.from(`${username}:${password}`).toString('base64')

  const response = await fetch(`${DATAFORSEO_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([task]),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ToolError(
      errorCodeForStatus(response.status),
      `DataForSEO API error (HTTP ${response.status}): ${text}`,
      response.status === 401 ? 'Check DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD match your DataForSEO API Access dashboard.' : undefined,
    )
  }

  const data = (await response.json()) as DataforseoResponse<R>
  const task0 = data.tasks?.[0]
  if (!task0) {
    throw new ToolError(ErrorCode.UPSTREAM_5XX, `DataForSEO returned no task result: ${data.status_message}`)
  }
  // DataForSEO signals task-level failures (bad params, no credits, etc.) with a
  // non-20000 status even on HTTP 200 — this is the caller's problem, not an outage.
  if (task0.status_code !== 20000) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `DataForSEO task failed: ${task0.status_message}`)
  }

  return task0.result ?? []
}
