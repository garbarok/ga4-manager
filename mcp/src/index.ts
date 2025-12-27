#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CLIExecutor } from './cli/executor.js'
import { mapCLIError } from './utils/errors.js'

// Import GA4 tools
import { ga4SetupTool } from './tools/ga4-setup.js'
import { ga4ReportTool } from './tools/ga4-report.js'
import { ga4CleanupTool } from './tools/ga4-cleanup.js'
import { ga4LinkTool } from './tools/ga4-link.js'
import { ga4ValidateTool } from './tools/ga4-validate.js'

// Import GSC tools
import {
  gscSitemapsListTool,
  gscSitemapsSubmitTool,
  gscSitemapsDeleteTool,
  gscSitemapsGetTool,
} from './tools/gsc-sitemaps.js'
import { gscInspectUrlTool } from './tools/gsc-inspect.js'
import { gscAnalyticsRunTool } from './tools/gsc-analytics.js'
import { gscMonitorUrlsTool } from './tools/gsc-monitor.js'

/**
 * GA4 Manager MCP Server
 *
 * Exposes GA4 Manager CLI commands as structured MCP tools for Claude Desktop
 * and Claude Code CLI.
 */

// Get binary path from environment or use default
const binaryPath = process.env.GA4_BINARY_PATH || '../ga4'

// Initialize CLI executor
const executor = new CLIExecutor(binaryPath)

// Create MCP server
const server = new Server(
  {
    name: 'ga4-manager',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // GA4 Tools (5)
      ga4SetupTool,
      ga4ReportTool,
      ga4CleanupTool,
      ga4LinkTool,
      ga4ValidateTool,

      // GSC Tools (7)
      gscSitemapsListTool,
      gscSitemapsSubmitTool,
      gscSitemapsDeleteTool,
      gscSitemapsGetTool,
      gscInspectUrlTool,
      gscAnalyticsRunTool,
      gscMonitorUrlsTool,
    ],
  }
})

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    // Import tool handlers dynamically to avoid circular dependencies
    switch (name) {
      case 'ga4_setup': {
        const { buildSetupArgs, parseSetupOutput, ga4SetupInputSchema } =
          await import('./tools/ga4-setup.js')
        const input = ga4SetupInputSchema.parse(args)
        const cliArgs = buildSetupArgs(input)
        const result = await executor.execute({
          command: 'setup',
          args: cliArgs,
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'ga4_setup')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseSetupOutput(result.stdout, input.dry_run || false)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'ga4_report': {
        const { buildReportArgs, parseReportOutput, ga4ReportInputSchema } =
          await import('./tools/ga4-report.js')
        const input = ga4ReportInputSchema.parse(args)
        const cliArgs = buildReportArgs(input)
        const result = await executor.execute({
          command: 'report',
          args: cliArgs,
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'ga4_report')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseReportOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'ga4_cleanup': {
        const { buildCleanupArgs, parseCleanupOutput, ga4CleanupInputSchema } =
          await import('./tools/ga4-cleanup.js')
        const input = ga4CleanupInputSchema.parse(args)
        const cliArgs = buildCleanupArgs(input)
        const result = await executor.execute({
          command: 'cleanup',
          args: cliArgs,
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'ga4_cleanup')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseCleanupOutput(result.stdout, input.dry_run || false)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'ga4_link': {
        const { buildLinkArgs, parseLinkOutput, ga4LinkInputSchema } =
          await import('./tools/ga4-link.js')
        const input = ga4LinkInputSchema.parse(args)
        const cliArgs = buildLinkArgs(input)
        const result = await executor.execute({
          command: 'link',
          args: cliArgs,
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'ga4_link')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseLinkOutput(result.stdout, input)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'ga4_validate': {
        const {
          buildValidateArgs,
          parseValidateOutput,
          ga4ValidateInputSchema,
        } = await import('./tools/ga4-validate.js')
        const input = ga4ValidateInputSchema.parse(args)
        const cliArgs = buildValidateArgs(input)
        const result = await executor.execute({
          command: 'validate',
          args: cliArgs,
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'ga4_validate')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseValidateOutput(
          result.stdout,
          input.verbose || false,
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      // ========== GSC Tools ==========

      case 'gsc_sitemaps_list': {
        const {
          buildSitemapsListArgs,
          parseSitemapsListOutput,
          gscSitemapsListInputSchema,
        } = await import('./tools/gsc-sitemaps.js')
        const input = gscSitemapsListInputSchema.parse(args)
        const cliArgs = buildSitemapsListArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_sitemaps_list')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseSitemapsListOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_sitemaps_submit': {
        const {
          buildSitemapsSubmitArgs,
          parseSitemapsSubmitOutput,
          gscSitemapsSubmitInputSchema,
        } = await import('./tools/gsc-sitemaps.js')
        const input = gscSitemapsSubmitInputSchema.parse(args)
        const cliArgs = buildSitemapsSubmitArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_sitemaps_submit')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseSitemapsSubmitOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_sitemaps_delete': {
        const {
          buildSitemapsDeleteArgs,
          parseSitemapsDeleteOutput,
          gscSitemapsDeleteInputSchema,
        } = await import('./tools/gsc-sitemaps.js')
        const input = gscSitemapsDeleteInputSchema.parse(args)
        const cliArgs = buildSitemapsDeleteArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_sitemaps_delete')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseSitemapsDeleteOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_sitemaps_get': {
        const {
          buildSitemapsGetArgs,
          parseSitemapsGetOutput,
          gscSitemapsGetInputSchema,
        } = await import('./tools/gsc-sitemaps.js')
        const input = gscSitemapsGetInputSchema.parse(args)
        const cliArgs = buildSitemapsGetArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_sitemaps_get')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseSitemapsGetOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_inspect_url': {
        const {
          buildInspectUrlArgs,
          parseInspectUrlOutput,
          gscInspectUrlInputSchema,
        } = await import('./tools/gsc-inspect.js')
        const input = gscInspectUrlInputSchema.parse(args)
        const cliArgs = buildInspectUrlArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_inspect_url')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseInspectUrlOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_analytics_run': {
        const {
          buildAnalyticsRunArgs,
          parseAnalyticsRunOutput,
          gscAnalyticsRunInputSchema,
        } = await import('./tools/gsc-analytics.js')
        const input = gscAnalyticsRunInputSchema.parse(args)
        const cliArgs = buildAnalyticsRunArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_analytics_run')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        const output = parseAnalyticsRunOutput(result.stdout)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      case 'gsc_monitor_urls': {
        const {
          buildMonitorUrlsArgs,
          parseMonitorUrlsOutput,
          gscMonitorUrlsInputSchema,
        } = await import('./tools/gsc-monitor.js')
        const input = gscMonitorUrlsInputSchema.parse(args)
        const cliArgs = buildMonitorUrlsArgs(input)
        const result = await executor.execute({
          command: 'gsc',
          args: cliArgs.slice(1),
        })

        if (result.exitCode !== 0) {
          const error = mapCLIError(result, 'gsc_monitor_urls')
          return {
            content: [{ type: 'text', text: JSON.stringify(error, null, 2) }],
            isError: true,
          }
        }

        // NOTE: parseMonitorUrlsOutput takes TWO parameters (output, input)
        const output = parseMonitorUrlsOutput(result.stdout, input)
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              stack: error instanceof Error ? error.stack : undefined,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    }
  }
})

/**
 * Start server
 */
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
