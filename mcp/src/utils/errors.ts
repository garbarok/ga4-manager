import type { CLIResult, CLIError } from '../types/cli.js';

// ============================================================================
// Standardized tool response contract (used by native tools)
// ============================================================================

export enum ErrorCode {
  AUTH_DENIED = 'AUTH_DENIED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INVALID_INPUT = 'INVALID_INPUT',
  UPSTREAM_5XX = 'UPSTREAM_5XX',
  NOT_FOUND = 'NOT_FOUND',
  PARTIAL_FETCH_FAILED = 'PARTIAL_FETCH_FAILED',
  /** The ga4 CLI failed for a reason none of the codes above describes. */
  CLI_FAILED = 'CLI_FAILED',
}

/**
 * Classify an upstream Google API HTTP failure. A 4xx that isn't auth, missing
 * resource or quota means the request itself was rejected (bad argument), so it
 * is the caller's input — not an upstream outage — and must not read as 5xx.
 */
export function errorCodeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return ErrorCode.AUTH_DENIED
  if (status === 404) return ErrorCode.NOT_FOUND
  if (status === 429) return ErrorCode.QUOTA_EXCEEDED
  if (status >= 400 && status < 500) return ErrorCode.INVALID_INPUT
  return ErrorCode.UPSTREAM_5XX
}

export class ToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

export interface ToolErrorShape {
  code: ErrorCode
  message: string
  hint?: string
}

export interface ToolFailureResult {
  success: false
  error: ToolErrorShape
}

/**
 * Build a standardized failure result. The `hint` field is omitted entirely
 * when not provided so it never serializes as `"hint": undefined`.
 */
export function errorResult(
  code: ErrorCode,
  message: string,
  hint?: string,
): ToolFailureResult {
  return {
    success: false,
    error: { code, message, ...(hint !== undefined ? { hint } : {}) },
  }
}

/**
 * Convert a thrown {@link ToolError} into a {@link ToolFailureResult}.
 * This is the single conversion point native tools use in their catch blocks,
 * replacing hand-rolled `{ success: false, error: { ... } }` literals.
 */
export function toolErrorToFailure(err: ToolError): ToolFailureResult {
  return errorResult(err.code, err.message, err.hint)
}

// ============================================================================
// CLI error mapping (used by legacy CLI-backed tools)
// ============================================================================

/**
 * Map CLI execution result to structured error object
 *
 * Analyzes stderr output to determine error type and provide
 * actionable suggestions for common errors.
 *
 * @param result - CLI execution result
 * @param toolName - Name of the MCP tool that failed
 * @returns Structured error object
 */
export function mapCLIError(result: CLIResult, toolName: string): CLIError {
  const stderr = result.stderr.toLowerCase();

  // Check for authentication errors (broader pattern matching)
  if (
    stderr.includes('google_application_credentials') ||
    stderr.includes('authentication failed') ||
    stderr.includes('authentication required') ||
    stderr.includes('invalid credentials') ||
    stderr.includes('credentials not found') ||
    stderr.includes('unauthorized') ||
    stderr.includes('unauthenticated') ||
    stderr.includes('not authenticated') ||
    stderr.includes('token expired') ||
    stderr.includes('access token') ||
    stderr.includes('oauth') ||
    stderr.includes('service account') ||
    stderr.includes('login required') ||
    stderr.includes('401') ||
    stderr.includes('403 forbidden')
  ) {
    return {
      code: 'AUTH_ERROR',
      message: 'Authentication failed',
      details: {
        stderr: result.stderr,
        exitCode: result.exitCode,
        suggestion: 'Set GOOGLE_APPLICATION_CREDENTIALS environment variable to path of your service account JSON file, or verify that your credentials are valid and not expired'
      }
    };
  }

  // Check for permission errors
  if (stderr.includes('permission denied') || stderr.includes('access denied')) {
    return {
      code: 'PERMISSION_ERROR',
      message: 'Permission denied',
      details: {
        stderr: result.stderr,
        exitCode: result.exitCode,
        suggestion: 'Verify that your service account has the required permissions for this operation'
      }
    };
  }

  // Check for validation errors (file not found, invalid config, etc.)
  if (stderr.includes('not found') || stderr.includes('invalid')) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Resource not found or invalid',
      details: {
        stderr: result.stderr,
        exitCode: result.exitCode
      }
    };
  }

  // Check for API quota errors
  if (stderr.includes('quota')) {
    return {
      code: 'API_ERROR',
      message: 'API quota exceeded',
      details: {
        stderr: result.stderr,
        exitCode: result.exitCode,
        suggestion: 'Wait for quota reset (usually at midnight Pacific Time) or request a quota increase'
      }
    };
  }

  // Generic CLI execution error
  return {
    code: 'CLI_EXECUTION_FAILED',
    message: `Command failed: ${toolName}`,
    details: {
      stderr: result.stderr,
      exitCode: result.exitCode
    }
  };
}


// ============================================================================
// CLI failures in the native error shape
// ============================================================================

const LOG_LINE = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} (INFO|DEBUG|WARN)\b|^time=\S+ level=(INFO|DEBUG|WARN)\b/

/**
 * stderr without progress logs and cobra's usage block, so the reason for the
 * failure is what remains. Truncated to keep tool results small.
 */
export function cleanStderr(stderr: string, max = 2000): string {
  const out: string[] = []
  for (const line of stderr.split('\n')) {
    if (/^Usage:\s*$/.test(line)) break // cobra usage block runs to the end
    if (LOG_LINE.test(line.trim())) continue
    out.push(line)
  }
  const text = out.join('\n').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * The one line that says why a CLI command failed: a Google API error, an
 * "Error:" line, a structured ERROR log, else the last non-log line.
 */
export function stderrMessage(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  const api = lines.map((l) => l.match(/googleapi: Error \d{3}: [^"]+/)?.[0]).find(Boolean)
  if (api) return api.replace(/,\s*\w+$/, '')
  const errorLine = lines.find((l) => /^(Error|✗)\b/.test(l))
  if (errorLine) return errorLine.replace(/^(Error:|✗)\s*/, '')
  const structured = lines.find((l) => /\bERROR\b/.test(l))
  if (structured) return structured.replace(/^.*?\bERROR\b\s*/, '')
  const rest = lines.filter((l) => !LOG_LINE.test(l))
  return rest[rest.length - 1] ?? 'no error output'
}

const ACCESS_HINT =
  'The credential has no access to this resource. Search Console: add the service account (client_email in the credentials JSON; ga4 gsc whoami prints it) as a user on the property. ' +
  'GA4: give it Viewer (Editor for writes) on the property. server_info with a site/property_id checks access. See mcp/PERMISSIONS.md.'

export type CliFailure = ToolFailureResult & { details: { exitCode: number; stderr: string } }

/** A failed ga4 CLI run as `{success: false, error: {code, message, hint}}`, like the native tools. */
export function cliFailure(result: CLIResult, toolName: string): CliFailure {
  const raw = result.stderr || result.stdout || ''
  const lower = raw.toLowerCase()
  const message = stderrMessage(raw)
  const details = { exitCode: result.exitCode, stderr: cleanStderr(raw) }
  const status = Number(raw.match(/googleapi: Error (\d{3})/)?.[1] ?? raw.match(/HTTP (\d{3})/)?.[1] ?? NaN)

  let code: ErrorCode
  let hint: string | undefined
  if (Number.isFinite(status)) {
    code = errorCodeForStatus(status)
    if (code === ErrorCode.AUTH_DENIED) hint = ACCESS_HINT
    else if (code === ErrorCode.QUOTA_EXCEEDED) hint = 'Quota exceeded: wait for the reset (midnight Pacific Time) or lower the request volume.'
  } else if (/caller does not have permission|sufficient permission|permission denied|access denied|forbidden/.test(lower)) {
    code = ErrorCode.AUTH_DENIED
    hint = ACCESS_HINT
  } else if (/google_application_credentials|credentials not found|could not find default credentials|invalid_grant|unauthenticated|token expired/.test(lower)) {
    code = ErrorCode.AUTH_DENIED
    hint = 'Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key or ADC file, or refresh expired user credentials. See mcp/PERMISSIONS.md.'
  } else if (/quota/.test(lower)) {
    code = ErrorCode.QUOTA_EXCEEDED
  } else if (/config not found|no such file|not found/.test(lower)) {
    code = ErrorCode.NOT_FOUND
  } else if (/invalid|unknown flag|required flag|must be|validation/.test(lower)) {
    code = ErrorCode.INVALID_INPUT
  } else {
    code = ErrorCode.CLI_FAILED
  }
  return { success: false, error: { code, message: `${toolName}: ${message}`, ...(hint ? { hint } : {}) }, details }
}
