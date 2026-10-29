import type { ToolAnnotations } from './tool-spec.js'

export type WriteGateResult =
  | { allowed: true }
  | {
      allowed: false
      failure: {
        success: false
        error: { code: 'INVALID_INPUT'; message: string; hint: string }
      }
    }

/** Env flags arrive as "" when unset through the .mcpb bundle, so only "1"/"true" count. */
function isOn(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

function refuse(message: string, hint: string): WriteGateResult {
  return {
    allowed: false,
    failure: { success: false, error: { code: 'INVALID_INPUT', message, hint } },
  }
}

/**
 * Decide whether a tool call may run. Read-only mode wins over the destructive
 * opt-in: with GA4M_READ_ONLY on, anything not marked readOnlyHint is refused.
 */
export function checkWriteGate(
  annotations: ToolAnnotations | undefined,
  env: Record<string, string | undefined>,
): WriteGateResult {
  if (isOn(env.GA4M_READ_ONLY) && annotations?.readOnlyHint !== true) {
    return refuse(
      'This tool changes data and the server is in read-only mode (GA4M_READ_ONLY).',
      'Unset GA4M_READ_ONLY (or set it to 0) to allow write tools.',
    )
  }
  if (annotations?.destructiveHint === true && !isOn(env.GA4M_ALLOW_DESTRUCTIVE)) {
    return refuse(
      'This tool is destructive and is disabled by default.',
      'Set GA4M_ALLOW_DESTRUCTIVE=1 in the MCP server environment to enable it.',
    )
  }
  return { allowed: true }
}
