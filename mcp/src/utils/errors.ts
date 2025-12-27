import type { CLIResult, CLIError } from '../types/cli';

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

  // Check for authentication errors
  if (stderr.includes('google_application_credentials')) {
    return {
      code: 'AUTH_ERROR',
      message: 'Missing Google credentials',
      details: {
        stderr: result.stderr,
        exitCode: result.exitCode,
        suggestion: 'Set GOOGLE_APPLICATION_CREDENTIALS environment variable to path of your service account JSON file'
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
