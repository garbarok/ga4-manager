import { z } from 'zod'
import { StateStore, resolveStateDir, siteKey } from './state-store.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from './errors.js'

/**
 * Input fields shared by tools that keep per-site local state: the site, and
 * where its state lives (ADR-0006 resolution order).
 */

export const siteStateShape = {
  site: z.string().min(1).describe('Site: domain (example.com), URL, or sc-domain:example.com'),
  config: z.string().optional().describe('Site config path; state is kept in .ga4-state/ next to it'),
  state_dir: z.string().optional().describe('Override the state directory'),
}

export const siteStateProperties = {
  site: { type: 'string', description: 'Site: domain (example.com), URL, or sc-domain:example.com' },
  config: { type: 'string', description: 'Site config path; state is kept in .ga4-state/ next to it' },
  state_dir: { type: 'string', description: 'Override the state directory (default: GA4M_STATE_DIR, next to config, or ./.ga4-state)' },
}

export function storeFor(input: { config?: string; state_dir?: string }): StateStore {
  return new StateStore(resolveStateDir({ stateDir: input.state_dir, config: input.config }))
}

/** Run a handler, converting thrown ToolErrors (and anything else) into the shared failure shape. */
export async function guard<T>(fn: () => Promise<T> | T): Promise<T | ToolFailureResult> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

export { siteKey }
