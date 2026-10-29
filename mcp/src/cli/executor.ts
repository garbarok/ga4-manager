import { spawn } from 'child_process';
import { accessSync, constants } from 'fs';
import type { CLIResult, CLIExecuteParams } from '../types/cli.js';
import { stripANSI } from '../utils/ansi-strip.js';

/**
 * Executes CLI commands and captures output.
 *
 * The binary path is validated on each CLI call, not at construction: an
 * npm install has no `ga4` binary, and native tools must keep working
 * without it. A missing binary fails that call with a remediation hint
 * instead of an opaque `spawn .../ga4 ENOENT`.
 */
export class CLIExecutor {
  private binaryPath: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(binaryPath: string) {
    this.binaryPath = binaryPath;
  }

  /** Whether the binary exists and is executable (for startup diagnostics). */
  isBinaryUsable(): boolean {
    try {
      accessSync(this.binaryPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private assertBinaryUsable(): void {
    try {
      accessSync(this.binaryPath, constants.X_OK);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `This tool needs the ga4 CLI binary, which was not found or is not executable at ${this.binaryPath} (${reason}).\n` +
          `Download it from https://github.com/garbarok/ga4-manager/releases and put it on PATH, ` +
          `or set GA4_BINARY_PATH. From a source checkout: 'make build' in the repo root.`,
        { cause: err },
      );
    }
  }

  /**
   * Execute a CLI command
   *
   * @param params - Execution parameters
   * @returns Result including stdout, stderr, exit code, and duration
   * @throws Error if timeout occurs
   */
  async execute(params: CLIExecuteParams): Promise<CLIResult> {
    this.assertBinaryUsable();
    const startTime = Date.now();
    const timeout = params.timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      // Build arguments: [command, ...args]
      const args = params.command ? [params.command, ...params.args] : params.args;

      // Spawn process
      const proc = spawn(this.binaryPath, args, {
        env: { ...process.env },
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';

      // Capture stdout
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // Capture stderr
      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Command execution timeout after ${timeout}ms`));
      }, timeout);

      // Handle process exit
      proc.on('exit', (exitCode: number | null) => {
        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;

        resolve({
          exitCode: exitCode ?? 1,
          stdout: stripANSI(stdout),
          stderr: stripANSI(stderr),
          duration
        });
      });

      // Handle process errors
      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }
}
