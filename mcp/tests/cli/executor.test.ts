import { describe, it, expect, beforeEach } from 'vitest';
import { CLIExecutor } from '../../src/cli/executor';
import type { CLIResult } from '../../src/types/cli';
import path from 'path';

describe('CLIExecutor', () => {
  let executor: CLIExecutor;
  // Binary path: use env var or resolve from project root
  const testBinaryPath = process.env.GA4_BINARY_PATH || path.resolve(__dirname, '../../../ga4');

  beforeEach(() => {
    executor = new CLIExecutor(testBinaryPath);
  });

  describe('execute', () => {
    it('should execute command and capture output', async () => {
      const result: CLIResult = await executor.execute({
        command: '--version',
        args: []
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ga4 version');
      // stderr may contain warnings (like GOOGLE_APPLICATION_CREDENTIALS)
      expect(result.stderr).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should capture stderr on error', async () => {
      const result: CLIResult = await executor.execute({
        command: 'invalid-command',
        args: []
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });

    it('should pass arguments correctly', async () => {
      const result: CLIResult = await executor.execute({
        command: 'report',
        args: ['--help']
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('report');
    });

    it('should strip ANSI color codes from output', async () => {
      // The ga4 binary uses color codes, executor should strip them
      const result: CLIResult = await executor.execute({
        command: 'report',
        args: ['--help']
      });

      // Should not contain ANSI escape sequences
      expect(result.stdout).not.toMatch(/\x1b\[[0-9;]*m/);
      expect(result.stderr).not.toMatch(/\x1b\[[0-9;]*m/);
    });

    it('should handle timeout', async () => {
      // Use a separate executor with /bin/sleep to test timeout
      const sleepExecutor = new CLIExecutor('/bin/sleep');

      await expect(
        sleepExecutor.execute({
          command: '5', // sleep for 5 seconds
          args: [],
          timeout: 100 // but timeout after 100ms
        })
      ).rejects.toThrow('Command execution timeout after 100ms');
    });

    it('should track execution duration', async () => {
      const startTime = Date.now();

      const result: CLIResult = await executor.execute({
        command: '--version',
        args: []
      });

      const actualDuration = Date.now() - startTime;

      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThanOrEqual(actualDuration + 10); // Allow 10ms tolerance
    });
  });
});
