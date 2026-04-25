// ============================================================================
// redirect-trace.ts — manual redirect following with hop recording
// ============================================================================

import { ToolError, ErrorCode } from './errors.js'

export interface RedirectHop {
  from: string
  to: string
  status: number
}

export interface TraceResult {
  chain: RedirectHop[]
  finalRes: Response
  finalUrl: string
}

const MAX_HOPS = 5
const REDIRECT_STATUSES = new Set([301, 302, 307, 308])

/**
 * Fetch URL with manual redirect following. Returns each hop in the chain.
 * Throws ToolError(UPSTREAM_5XX) on redirect loop or when hop limit exceeded.
 */
export async function fetchWithTrace(url: string, opts?: RequestInit): Promise<TraceResult> {
  const chain: RedirectHop[] = []
  const visited = new Set<string>()
  let currentUrl = url

  for (;;) {
    if (visited.has(currentUrl)) {
      throw new ToolError(
        ErrorCode.UPSTREAM_5XX,
        `Redirect loop detected: ${currentUrl} was visited twice`,
      )
    }
    if (chain.length >= MAX_HOPS) {
      throw new ToolError(
        ErrorCode.UPSTREAM_5XX,
        `Redirect hop limit exceeded (max ${MAX_HOPS})`,
      )
    }

    visited.add(currentUrl)
    const res = await fetch(currentUrl, { ...opts, redirect: 'manual' })

    if (!REDIRECT_STATUSES.has(res.status)) {
      return { chain, finalRes: res, finalUrl: currentUrl }
    }

    const location = res.headers.get('location')
    if (!location) {
      return { chain, finalRes: res, finalUrl: currentUrl }
    }

    const toUrl = new URL(location, currentUrl).href
    chain.push({ from: currentUrl, to: toUrl, status: res.status })
    currentUrl = toUrl
  }
}
