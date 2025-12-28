import { describe, it, expect } from 'vitest';
import { mapCLIError } from '../../src/utils/errors';
import type { CLIResult, CLIError } from '../../src/types/cli';

describe('mapCLIError', () => {
  it('should detect authentication errors', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: GOOGLE_APPLICATION_CREDENTIALS not set',
      duration: 100
    };

    const error: CLIError = mapCLIError(result, 'ga4_setup');

    expect(error.code).toBe('AUTH_ERROR');
    expect(error.message).toContain('Authentication failed');
    expect(error.details.suggestion).toContain('GOOGLE_APPLICATION_CREDENTIALS');
  });

  it('should detect validation errors', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: config file not found: configs/missing.yaml',
      duration: 50
    };

    const error: CLIError = mapCLIError(result, 'ga4_validate');

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('not found');
    expect(error.details.stderr).toBeTruthy();
  });

  it('should detect API quota errors', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: quota exceeded for Analytics Admin API',
      duration: 200
    };

    const error: CLIError = mapCLIError(result, 'gsc_analytics_run');

    expect(error.code).toBe('API_ERROR');
    expect(error.message).toContain('quota');
    expect(error.details.suggestion).toBeTruthy();
  });

  it('should handle generic CLI errors', () => {
    const result: CLIResult = {
      exitCode: 2,
      stdout: '',
      stderr: 'Unknown error occurred',
      duration: 75
    };

    const error: CLIError = mapCLIError(result, 'ga4_cleanup');

    expect(error.code).toBe('CLI_EXECUTION_FAILED');
    expect(error.message).toContain('ga4_cleanup');
    expect(error.details.exitCode).toBe(2);
    expect(error.details.stderr).toBe('Unknown error occurred');
  });

  it('should include tool name in error message', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Some error',
      duration: 10
    };

    const error: CLIError = mapCLIError(result, 'gsc_inspect_url');

    expect(error.message).toContain('gsc_inspect_url');
  });

  it('should preserve original stderr in details', () => {
    const originalStderr = 'Detailed error message with stack trace';
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: originalStderr,
      duration: 100
    };

    const error: CLIError = mapCLIError(result, 'ga4_link');

    expect(error.details.stderr).toBe(originalStderr);
  });

  it('should provide helpful suggestions for auth errors', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Missing GOOGLE_APPLICATION_CREDENTIALS',
      duration: 10
    };

    const error: CLIError = mapCLIError(result, 'ga4_report');

    expect(error.details.suggestion).toContain('environment variable');
  });

  it('should detect permission errors', () => {
    const result: CLIResult = {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: permission denied accessing property 513421535',
      duration: 150
    };

    const error: CLIError = mapCLIError(result, 'ga4_setup');

    expect(error.code).toBe('PERMISSION_ERROR');
    expect(error.message.toLowerCase()).toContain('permission');
  });
});
