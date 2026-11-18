import { getGoogleAuthHeaders } from './google-auth.js'
import { ToolError, ErrorCode, errorCodeForStatus } from './errors.js'
import type { GscRow } from '../tools/compute-traffic-diff.js'

/**
 * Search Analytics query with dimension filters, for native tools that need
 * one page or one path prefix (gsc_change_impact). Read-only scope.
 */

export interface GscFilter {
  dimension: 'page' | 'query' | 'country' | 'device'
  operator: 'equals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex'
  expression: string
}

export async function querySearchFiltered(
  site: string,
  q: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number; filters?: GscFilter[] },
): Promise<GscRow[]> {
  const headers = await getGoogleAuthHeaders(['https://www.googleapis.com/auth/webmasters.readonly'])
  const body: Record<string, unknown> = {
    startDate: q.startDate,
    endDate: q.endDate,
    dimensions: q.dimensions,
    rowLimit: q.rowLimit ?? 1000,
  }
  if (q.filters?.length) body.dimensionFilterGroups = [{ groupType: 'and', filters: q.filters }]
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 403) {
      throw new ToolError(ErrorCode.AUTH_DENIED, 'GSC access denied (HTTP 403)', 'Add the credential as a user on this Search Console site.')
    }
    throw new ToolError(errorCodeForStatus(res.status), `GSC API error (HTTP ${res.status}): ${text}`)
  }
  return ((await res.json()) as { rows?: GscRow[] }).rows ?? []
}

/** RE2-safe regex for "page starts with prefix". */
export function prefixRegex(prefix: string): string {
  return '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
