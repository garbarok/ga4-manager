/**
 * Result of CLI command execution
 */
export interface CLIResult {
  /** Exit code from the process */
  exitCode: number;
  /** Standard output (ANSI codes stripped) */
  stdout: string;
  /** Standard error (ANSI codes stripped) */
  stderr: string;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Parameters for CLI execution
 */
export interface CLIExecuteParams {
  /** Command name (e.g., 'setup', 'report', 'cleanup') */
  command: string;
  /** Command arguments */
  args: string[];
  /** Optional timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Parsed CLI output
 */
export interface ParsedOutput {
  /** Detected format */
  format: 'json' | 'table' | 'csv' | 'markdown' | 'text';
  /** Parsed data */
  data: unknown;
  /** Optional parse error message if parsing failed */
  parseError?: string;
}

/**
 * Structured error from CLI execution
 */
export interface CLIError {
  /** Error code (e.g., 'AUTH_ERROR', 'VALIDATION_ERROR') */
  code: string;
  /** Human-readable message */
  message: string;
  /** Additional error details */
  details: {
    /** Original stderr output */
    stderr?: string;
    /** Exit code */
    exitCode?: number;
    /** Actionable suggestion */
    suggestion?: string;
  };
}
