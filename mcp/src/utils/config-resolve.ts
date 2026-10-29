import type { CLIExecutor } from '../cli/executor.js'
import { ToolError, ErrorCode } from './errors.js'

/**
 * The subset of a YAML config that native tools need, as emitted by
 * `ga4 config resolve --format json`. Native tools never parse YAML
 * themselves (design D4): the Go binary is the single config reader, so
 * validation behaves identically for CLI and MCP.
 */
export interface ResolvedConfig {
  path: string
  project: string
  property_id: string
  gsc_site: string
  hreflang_pairs: Record<string, string>[]
}

export type ConfigSelector = { config: string } | { all: true }

export async function resolveConfigs(
  executor: CLIExecutor,
  selector: ConfigSelector,
): Promise<ResolvedConfig[]> {
  const args =
    'config' in selector
      ? ['resolve', '--config', selector.config, '--format', 'json']
      : ['resolve', '--all', '--format', 'json']

  const result = await executor.execute({ command: 'config', args })
  if (result.exitCode !== 0) {
    throw new ToolError(
      ErrorCode.INVALID_INPUT,
      `Failed to resolve config: ${(result.stderr || result.stdout).trim()}`,
      'Check the config path exists and is valid YAML (ga4 config resolve --config <path>).',
    )
  }

  try {
    return JSON.parse(result.stdout) as ResolvedConfig[]
  } catch {
    throw new ToolError(
      ErrorCode.UPSTREAM_5XX,
      'ga4 config resolve returned non-JSON output',
      'Rebuild the ga4 binary (make build) so it matches this MCP server version.',
    )
  }
}
