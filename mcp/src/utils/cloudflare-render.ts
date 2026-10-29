import { ToolError, ErrorCode, errorCodeForStatus } from './errors.js'
import { TTLCache } from './cache.js'

/**
 * Thin client for Cloudflare's Browser Rendering REST API — a hosted headless
 * Chrome that executes a page's JavaScript before returning its DOM. Used to
 * audit JS-rendered (SPA) pages, which a plain `fetch()` never sees past the
 * initial server-rendered shell.
 *
 * @see https://developers.cloudflare.com/browser-rendering/rest-api/content-endpoint/
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareRenderOptions {
  accountId?: string
  apiToken?: string
}

interface CloudflareContentResponse {
  success: boolean
  result?: string
  errors?: { code: number; message: string }[]
}

// 5-minute TTL: Browser Rendering is billed per call, so repeated audits of the
// same URL within a short window reuse the last render (mirrors seo-page-audit's psiCache).
export const renderCache = new TTLCache<string>(5 * 60 * 1000)

/**
 * Render `url` with Cloudflare Browser Rendering and return the resulting HTML
 * (post-JavaScript DOM). Falls back to `CF_ACCOUNT_ID`/`CF_API_TOKEN` env vars
 * when `opts` omits them, mirroring the `PSI_API_KEY` fallback in seo-page-audit.ts.
 */
export async function renderHtml(url: string, opts: CloudflareRenderOptions = {}): Promise<string> {
  const accountId = opts.accountId ?? (process.env.CF_ACCOUNT_ID || undefined)
  const apiToken = opts.apiToken ?? (process.env.CF_API_TOKEN || undefined)

  if (!accountId || !apiToken) {
    throw new ToolError(
      ErrorCode.AUTH_DENIED,
      'render_js requires Cloudflare Browser Rendering credentials.',
      'Set CF_ACCOUNT_ID and CF_API_TOKEN (env vars or per-call cf_account_id/cf_api_token) — see mcp/PERMISSIONS.md#cloudflare-browser-rendering',
    )
  }

  const cacheKey = `${accountId}|${url}`
  const cached = renderCache.get(cacheKey)
  if (cached !== undefined) return cached

  const response = await fetch(`${CF_API_BASE}/accounts/${accountId}/browser-rendering/content`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ToolError(
      errorCodeForStatus(response.status),
      `Cloudflare Browser Rendering error (HTTP ${response.status}): ${text}`,
      response.status === 401 || response.status === 403
        ? 'Check CF_API_TOKEN has the "Browser Rendering – Edit" permission and CF_ACCOUNT_ID is correct.'
        : undefined,
    )
  }

  const data = (await response.json()) as CloudflareContentResponse
  if (!data.success || typeof data.result !== 'string') {
    const message = data.errors?.map((e) => e.message).join('; ') || 'Cloudflare returned no rendered content'
    throw new ToolError(ErrorCode.UPSTREAM_5XX, `Cloudflare Browser Rendering failed: ${message}`)
  }

  renderCache.set(cacheKey, data.result)
  return data.result
}
