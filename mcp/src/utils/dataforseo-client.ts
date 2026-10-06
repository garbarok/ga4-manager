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
  cost?: number | null
  result?: R[] | null
}

interface DataforseoResponse<R> {
  status_code: number
  status_message: string
  cost?: number | null
  tasks?: DataforseoTask<R>[] | null
}

/** A task's result items plus the USD cost DataForSEO billed for the request (null when not reported). */
export interface DataforseoResult<R> {
  items: R[]
  cost: number | null
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
 * Lowercase host of a domain or URL, without scheme, leading `www.`, port or path:
 * `https://www.Example.com/calc` → `example.com`.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
}

/**
 * Call one DataForSEO endpoint and return its first task's result array plus the call cost.
 * `path` is the part after `/v3/`, e.g. "keywords_data/google_ads/search_volume/live".
 * POST wraps `task` in the array body DataForSEO expects; GET (e.g. "appendix/user_data") sends no body.
 */
export async function dataforseoRequest<R>(
  req: { method?: 'GET' | 'POST'; path: string; task?: Record<string, unknown>; timeoutMs?: number },
  creds: DataforseoCredentials = {},
): Promise<DataforseoResult<R>> {
  const { username, password } = resolveCredentials(creds)
  const auth = Buffer.from(`${username}:${password}`).toString('base64')
  const method = req.method ?? 'POST'

  const response = await fetch(`${DATAFORSEO_BASE}/${req.path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify([req.task ?? {}]) } : {}),
    signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
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

  const cost = typeof task0.cost === 'number' ? task0.cost : typeof data.cost === 'number' ? data.cost : null
  return { items: task0.result ?? [], cost }
}

/** POST one task to a DataForSEO "live" endpoint and return its first result array (cost discarded). */
export async function dataforseoPost<R>(
  path: string,
  task: Record<string, unknown>,
  creds: DataforseoCredentials = {},
): Promise<R[]> {
  return (await dataforseoRequest<R>({ method: 'POST', path, task }, creds)).items
}

/** Sum call costs; null only when every cost is unknown. Rounded to avoid float noise (0.1 + 0.2). */
export function sumCosts(costs: (number | null)[]): number | null {
  const known = costs.filter((c): c is number => c !== null)
  if (known.length === 0) return null
  return Math.round(known.reduce((a, b) => a + b, 0) * 1e6) / 1e6
}
