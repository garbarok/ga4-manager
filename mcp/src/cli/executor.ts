import { spawn } from 'child_process';
import type { CLIResult, CLIExecuteParams } from '../types/cli.js';
import { stripANSI } from '../utils/ansi-strip.js';

/**
 * Executes CLI commands and captures output
 */
export class CLIExecutor {
  private binaryPath: string;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(binaryPath: string) {
    this.binaryPath = binaryPath;
  }

  /**
   * Execute a CLI command
   *
   * @param params - Execution parameters
   * @returns Result including stdout, stderr, exit code, and duration
   * @throws Error if timeout occurs
   */
  async execute(params: CLIExecuteParams): Promise<CLIResult> {
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
