import { ToolError, ErrorCode, errorCodeForStatus } from './errors.js'

/**
 * Thin client for the ValueSERP API — live Google SERP snapshots, used here to
 * check a domain's actual rank for a keyword today (distinct from GSC's
 * impression-weighted historical average position).
 *
 * @see https://www.valueserp.com/docs/search-api/overview
 */

const VALUESERP_BASE = 'https://api.valueserp.com/search'

export interface ValueSerpOrganicResult {
  position: number
  title: string
  link: string
  domain?: string
  snippet?: string
}

export interface ValueSerpAiOverviewSource {
  url: string
  domain: string | null
  title: string | null
}

interface ValueSerpAiOverviewBlock {
  // Present without include_ai_overview when Google shows one, e.g.
  // "Google offers an AI Overview for this search. To get AI overview
  // result, please use the include_ai_overview=true request parameter."
  message?: string
  ai_overview_sources?: { source_url: string; source_domain?: string; source_title?: string }[]
}

interface ValueSerpResponse {
  request_info?: { success: boolean; message?: string }
  organic_results?: ValueSerpOrganicResult[]
  ai_overview?: ValueSerpAiOverviewBlock
}

export interface ValueSerpSearchParams {
  q: string
  location?: string
  google_domain?: string
  num?: number
  api_key?: string
  /** Fetch the AI Overview's cited sources too (costs an extra ValueSERP credit when one exists). */
  include_ai_overview?: boolean
}

export interface ValueSerpSearchResult {
  organic: ValueSerpOrganicResult[]
  /**
   * True when Google shows an AI Overview for this query — detected for free from
   * the base response's `ai_overview.message` hint, without paying the extra credit
   * `include_ai_overview` costs. Callers can use this to decide whether it's worth
   * a follow-up call for the actual `ai_overview_sources` citation list.
   */
  aiOverviewPresent: boolean
  /** Populated only when `include_ai_overview: true` was passed and Google returned sources. */
  aiOverviewSources: ValueSerpAiOverviewSource[]
}

/**
 * ValueSERP runs a live Google search per request; with `include_ai_overview`
 * it also renders the AI Overview, which regularly takes well over 30 s. The
 * old 30 s limit timed out on most AI Overview checks.
 */
export const VALUESERP_TIMEOUT_MS = 90_000
const MAX_ATTEMPTS = 2

function isRetryable(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

/** One retry on timeout or 5xx; other failures (auth, 4xx) are returned at once. */
async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(VALUESERP_TIMEOUT_MS) })
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) continue
      return response
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err
    }
  }
}

async function doSearch(params: ValueSerpSearchParams): Promise<ValueSerpResponse> {
  const apiKey = params.api_key ?? (process.env.VALUESERP_API_KEY || undefined)
  if (!apiKey) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'This tool requires a ValueSERP API key.',
      'Set VALUESERP_API_KEY (env var or a per-call override) — see mcp/PERMISSIONS.md#valueserp',
    )
  }

  const query = new URLSearchParams({
    api_key: apiKey,
    q: params.q,
    location: params.location ?? 'United States',
    google_domain: params.google_domain ?? 'google.com',
    num: String(params.num ?? 100),
    output: 'json',
  })
  if (params.include_ai_overview) query.set('include_ai_overview', 'true')

  const response = await fetchWithRetry(`${VALUESERP_BASE}?${query.toString()}`)

  if (!response.ok) {
    const text = await response.text()
    throw new ToolError(
      errorCodeForStatus(response.status),
      `ValueSERP API error (HTTP ${response.status}): ${text}`,
      response.status === 401 ? 'Check VALUESERP_API_KEY against your ValueSERP dashboard.' : undefined,
    )
  }

  const data = (await response.json()) as ValueSerpResponse
  if (data.request_info && data.request_info.success === false) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `ValueSERP request failed: ${data.request_info.message ?? 'unknown error'}`)
  }
  return data
}

/**
 * Google increasingly answers informational queries with an AI Overview, which
 * shrinks the classic organic block and can cite a page there instead of ranking
 * it among `organic_results` — a site can be absent from organic and still be
 * exactly what Google is showing searchers. This surfaces both so callers don't
 * mistake "not in organic" for "not ranking at all".
 */
export async function valueSerpSearch(params: ValueSerpSearchParams): Promise<ValueSerpSearchResult> {
  const data = await doSearch(params)

  const aiOverviewSources: ValueSerpAiOverviewSource[] = (data.ai_overview?.ai_overview_sources ?? []).map((s) => ({
    url: s.source_url,
    domain: s.source_domain ?? null,
    title: s.source_title ?? null,
  }))

  return {
    organic: data.organic_results ?? [],
    aiOverviewPresent: Boolean(data.ai_overview?.message) || aiOverviewSources.length > 0,
    aiOverviewSources,
  }
}
