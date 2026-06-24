#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CLIExecutor } from './cli/executor.js'
import { mapCLIError } from './utils/errors.js'
import { fileURLToPath } from 'url'
import { dirname, join, delimiter } from 'path'
import { accessSync, constants, readFileSync } from 'fs'
import { isSuccessExit } from './tool-spec.js'
import { SPECS, SPEC_BY_NAME } from './registry.js'

/**
 * GA4 Manager MCP Server
 *
 * Exposes GA4 Manager CLI commands as structured MCP tools for Claude Desktop
 * and Claude Code CLI.
 *
 * Every tool is one deep module that exports its own ToolSpec; ./registry.ts
 * collects them into SPECS, which drives both `tools/list` and `tools/call`.
 * This file is just the server bootstrap: binary resolution and dispatch.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Resolve the ga4 CLI binary, in priority order:
 *   1. GA4_BINARY_PATH — explicit override (used verbatim, even if missing,
 *      so an intentional misconfiguration still surfaces a clear error).
 *   2. The repo-root build next to mcp/ (../../ga4) — the dev default.
 *   3. A `ga4` on the user's PATH (e.g. a globally installed binary).
 *
 * Without (3), installing the CLI globally but not symlinking it into the
 * repo root crashed the server on startup. Falling back to PATH removes
 * the need for that manual symlink. If nothing is found, we return the
 * repo-root default so CLIExecutor emits the helpful "build it first" hint.
 */
function resolveBinaryPath(): string {
  if (process.env.GA4_BINARY_PATH) return process.env.GA4_BINARY_PATH

  const repoRootBinary = join(__dirname, '../../ga4')
  if (isExecutable(repoRootBinary)) return repoRootBinary

  const onPath = findOnPath('ga4')
  if (onPath) return onPath

  return repoRootBinary
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH
  if (!pathEnv) return null
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

const binaryPath = resolveBinaryPath()
const executor = new CLIExecutor(binaryPath)

// Single source of truth for the server version: package.json (dist/ -> ../package.json).
function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
const serverVersion = readServerVersion()

// ============================================================================
// MCP response helpers
// ============================================================================

function jsonContent(payload: unknown, isError = false) {
  const response: { content: { type: 'text'; text: string }[]; isError?: true } = {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
  if (isError) response.isError = true
  return response
}

// ============================================================================
// Server
// ============================================================================

const server = new Server(
  { name: 'ga4-manager', version: serverVersion },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: SPECS.map((spec) => spec.tool),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const spec = SPEC_BY_NAME.get(name)
    if (!spec) throw new Error(`Unknown tool: ${name}`)

    const input = spec.schema.parse(args) as never

    if (spec.kind === 'native') {
      const { output, isError } = await spec.run(input, executor)
      return jsonContent(output, isError)
    }

    const result = await executor.execute({
      command: spec.command,
      args: spec.buildArgs(input),
    })
    if (!isSuccessExit(result.exitCode)) {
      return jsonContent(mapCLIError(result, name), true)
    }
    return jsonContent(spec.parse(result.stdout, input))
  } catch (error) {
    return jsonContent(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      true,
    )
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('GA4 Manager MCP Server running on stdio')
  console.error(`Binary path: ${binaryPath}`)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
