#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { CLIExecutor } from './cli/executor.js'
import { SPECS } from './registry.js'
import { PROMPTS, PromptError, getPrompt } from './prompts.js'
import { dispatchTool } from './dispatch.js'
import { resolveBinaryPath, readServerVersion } from './binary.js'
import { applyCredentialsFromEnv } from './utils/credentials-env.js'

/**
 * GA4 Manager MCP Server
 *
 * Every tool is one deep module that exports its own ToolSpec; ./registry.ts
 * collects them into SPECS, which drives `tools/list`. `tools/call` goes
 * through ./dispatch.ts, the same path the `ga4m` command line uses
 * (ADR-0006). This file is just the stdio bootstrap.
 */

applyCredentialsFromEnv()
const binaryPath = resolveBinaryPath()
const executor = new CLIExecutor(binaryPath)
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
  { capabilities: { tools: {}, prompts: {} } },
)

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  try {
    return getPrompt(request.params.name, request.params.arguments)
  } catch (error) {
    if (error instanceof PromptError) throw new McpError(ErrorCode.InvalidParams, error.message)
    throw error
  }
})

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: SPECS.map((spec) => spec.tool),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const { output, isError } = await dispatchTool(name, args, executor)
  return jsonContent(output, isError)
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('GA4 Manager MCP Server running on stdio')
  console.error(
    executor.isBinaryUsable()
      ? `Binary path: ${binaryPath}`
      : `ga4 CLI binary not found at ${binaryPath}: native tools work, CLI-backed tools will report how to install it`,
  )
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
