#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { CLIExecutor } from './cli/executor.js'
import { mapCLIError } from './utils/errors.js'
import { fileURLToPath } from 'url'
import { dirname, join, delimiter } from 'path'
import { accessSync, constants, readFileSync } from 'fs'

// GA4 tools (CLI-backed)
import {
  ga4SetupTool,
  ga4SetupInputSchema,
  buildSetupArgs,
  parseSetupOutput,
} from './tools/ga4-setup.js'
import {
  ga4ReportTool,
  ga4ReportInputSchema,
  buildReportArgs,
  parseReportOutput,
} from './tools/ga4-report.js'
import {
  ga4CleanupTool,
  ga4CleanupInputSchema,
  buildCleanupArgs,
  parseCleanupOutput,
} from './tools/ga4-cleanup.js'
import {
  ga4LinkListTool,
  ga4LinkCreateTool,
  ga4LinkRemoveTool,
  ga4LinkListInputSchema,
  ga4LinkCreateInputSchema,
  ga4LinkRemoveInputSchema,
  buildLinkListArgs,
  buildLinkCreateArgs,
  buildLinkRemoveArgs,
  parseLinkListOutput,
  parseLinkCreateOutput,
  parseLinkRemoveOutput,
} from './tools/ga4-link.js'
import {
  ga4ValidateTool,
  ga4ValidateInputSchema,
  buildValidateArgs,
  parseValidateOutput,
} from './tools/ga4-validate.js'

// GSC tools (CLI-backed)
import {
  gscSitemapsListTool,
  gscSitemapsSubmitTool,
  gscSitemapsDeleteTool,
  gscSitemapsGetTool,
  gscSitemapsListInputSchema,
  gscSitemapsSubmitInputSchema,
  gscSitemapsDeleteInputSchema,
  gscSitemapsGetInputSchema,
  buildSitemapsListArgs,
  buildSitemapsSubmitArgs,
  buildSitemapsDeleteArgs,
  buildSitemapsGetArgs,
  parseSitemapsListOutput,
  parseSitemapsSubmitOutput,
  parseSitemapsDeleteOutput,
  parseSitemapsGetOutput,
} from './tools/gsc-sitemaps.js'
import {
  gscInspectUrlTool,
  gscInspectUrlInputSchema,
  buildInspectUrlArgs,
  parseInspectUrlOutput,
} from './tools/gsc-inspect.js'
import {
  gscAnalyticsRunTool,
  gscAnalyticsRunInputSchema,
  buildAnalyticsRunArgs,
  parseAnalyticsRunOutput,
} from './tools/gsc-analytics.js'
import {
  gscIndexCoverageTool,
  gscIndexCoverageInputSchema,
  buildIndexCoverageArgs,
  parseIndexCoverageOutput,
} from './tools/gsc-coverage.js'
import {
  gscCannibalizationTool,
  gscCannibalizationInputSchema,
  buildCannibalizationArgs,
  parseCannibalizationOutput,
} from './tools/gsc-cannibalization.js'
import {
  gscOpportunitiesTool,
  gscOpportunitiesInputSchema,
  buildOpportunitiesArgs,
  parseOpportunitiesOutput,
} from './tools/gsc-opportunities.js'
import {
  gscCTRAnomalyTool,
  gscCTRAnomalyInputSchema,
  buildCTRAnomalyArgs,
  parseCTRAnomalyOutput,
} from './tools/gsc-ctr-anomaly.js'
import {
  gscHealthTool,
  gscHealthInputSchema,
  buildHealthArgs,
  parseHealthOutput,
} from './tools/gsc-health.js'

// gsc_monitor_urls is dual-mode (native URL loop OR CLI), handled below.
import {
  gscMonitorUrlsTool,
  gscMonitorUrlsInputSchema,
  buildMonitorUrlsArgs,
  parseMonitorUrlsOutput,
  processUrlArrayMode,
} from './tools/gsc-monitor.js'

// Native tools (no CLI dependency)
import {
  gscTrafficCompareTool,
  gscTrafficCompareInputSchema,
  runGscTrafficCompare,
} from './tools/gsc-traffic-compare.js'
import {
  ga4ConsentHealthTool,
  ga4ConsentHealthInputSchema,
  runGa4ConsentHealth,
} from './tools/ga4-consent-health.js'
import {
  seoPageAuditTool,
  seoPageAuditInputSchema,
  runSeoPageAudit,
} from './tools/seo-page-audit.js'
import {
  seoAuditBatchTool,
  seoAuditBatchInputSchema,
  runSeoAuditBatch,
} from './tools/seo-audit-batch.js'

/**
 * GA4 Manager MCP Server
 *
 * Exposes GA4 Manager CLI commands as structured MCP tools for Claude Desktop
 * and Claude Code CLI.
 *
 * Every tool is registered once in the SPECS table below, which drives both
 * `tools/list` and `tools/call`. There is no per-tool dispatch boilerplate:
 * a CLI tool is `{ command, buildArgs, parse }` data; a native tool owns its
 * own async `run`.
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

// Framework convention (see CONTEXT.md, docs/BACKLOG.md "Implementation notes"):
//   exit 0 — clean run, no findings
//   exit 1 — command failed (API error, malformed config, etc.)
//   exit 2 — success with findings (e.g. cannibalising queries detected)
//
// Both 0 and 2 are success at the MCP dispatch layer; the parsed JSON
// envelope tells the caller whether findings exist. Treating 2 as failure
// would swallow stdout — the very report the tool exists to surface.
const SUCCESS_EXIT_CODES = new Set([0, 2])
const isSuccessExit = (code: number): boolean => SUCCESS_EXIT_CODES.has(code)

// ============================================================================
// Tool registry
// ============================================================================

/** Standard MCP tool annotations (title + behavior hints). */
interface ToolAnnotations {
  title: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** The shape every tool module exports as its MCP definition. */
interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
}

/**
 * A CLI-backed tool: validate input → build args → run the `ga4` binary →
 * parse stdout. `command` is the top-level `ga4` subcommand ('setup',
 * 'report', 'gsc', …) and `buildArgs` returns everything after it.
 */
interface CliToolSpec {
  kind: 'cli'
  tool: ToolDef
  schema: z.ZodType
  command: string
  buildArgs: (input: never) => string[]
  parse: (stdout: string, input: never) => unknown
}

/**
 * A native tool with no CLI dependency (or a non-uniform flow, like the
 * dual-mode monitor). It owns its handler and reports `isError` itself.
 */
interface NativeToolSpec {
  kind: 'native'
  tool: ToolDef
  schema: z.ZodType
  run: (input: never, executor: CLIExecutor) => Promise<{ output: unknown; isError: boolean }>
}

type ToolSpec = CliToolSpec | NativeToolSpec

/** Type-checked CLI spec builder: callbacks are validated against the schema's output type. */
function cli<S extends z.ZodType>(def: {
  tool: ToolDef
  schema: S
  command: string
  buildArgs: (input: z.infer<S>) => string[]
  parse: (stdout: string, input: z.infer<S>) => unknown
}): CliToolSpec {
  return { kind: 'cli', ...def } as CliToolSpec
}

/** Type-checked native spec builder. */
function native<S extends z.ZodType>(def: {
  tool: ToolDef
  schema: S
  run: (input: z.infer<S>, executor: CLIExecutor) => Promise<{ output: unknown; isError: boolean }>
}): NativeToolSpec {
  return { kind: 'native', ...def } as NativeToolSpec
}

const SPECS: ToolSpec[] = [
  // ── GA4 (CLI) ─────────────────────────────────────────────────────────────
  cli({
    tool: ga4SetupTool,
    schema: ga4SetupInputSchema,
    command: 'setup',
    buildArgs: buildSetupArgs,
    parse: (out, input) => parseSetupOutput(out, input.dry_run || false),
  }),
  cli({
    tool: ga4ReportTool,
    schema: ga4ReportInputSchema,
    command: 'report',
    buildArgs: buildReportArgs,
    parse: (out) => parseReportOutput(out),
  }),
  cli({
    tool: ga4CleanupTool,
    schema: ga4CleanupInputSchema,
    command: 'cleanup',
    buildArgs: buildCleanupArgs,
    parse: (out, input) => parseCleanupOutput(out, input.dry_run || false),
  }),
  cli({
    tool: ga4LinkListTool,
    schema: ga4LinkListInputSchema,
    command: 'link',
    buildArgs: buildLinkListArgs,
    parse: (out) => parseLinkListOutput(out),
  }),
  cli({
    tool: ga4LinkCreateTool,
    schema: ga4LinkCreateInputSchema,
    command: 'link',
    buildArgs: buildLinkCreateArgs,
    parse: (out, input) => parseLinkCreateOutput(out, input.service),
  }),
  cli({
    tool: ga4LinkRemoveTool,
    schema: ga4LinkRemoveInputSchema,
    command: 'link',
    buildArgs: buildLinkRemoveArgs,
    parse: (out, input) => parseLinkRemoveOutput(out, input.service),
  }),
  cli({
    tool: ga4ValidateTool,
    schema: ga4ValidateInputSchema,
    command: 'validate',
    buildArgs: buildValidateArgs,
    parse: (out, input) => parseValidateOutput(out, input.verbose || false),
  }),

  // ── GSC (CLI) ─────────────────────────────────────────────────────────────
  cli({
    tool: gscSitemapsListTool,
    schema: gscSitemapsListInputSchema,
    command: 'gsc',
    buildArgs: buildSitemapsListArgs,
    parse: (out) => parseSitemapsListOutput(out),
  }),
  cli({
    tool: gscSitemapsSubmitTool,
    schema: gscSitemapsSubmitInputSchema,
    command: 'gsc',
    buildArgs: buildSitemapsSubmitArgs,
    parse: (out) => parseSitemapsSubmitOutput(out),
  }),
  cli({
    tool: gscSitemapsDeleteTool,
    schema: gscSitemapsDeleteInputSchema,
    command: 'gsc',
    buildArgs: buildSitemapsDeleteArgs,
    parse: (out) => parseSitemapsDeleteOutput(out),
  }),
  cli({
    tool: gscSitemapsGetTool,
    schema: gscSitemapsGetInputSchema,
    command: 'gsc',
    buildArgs: buildSitemapsGetArgs,
    parse: (out) => parseSitemapsGetOutput(out),
  }),
  cli({
    tool: gscInspectUrlTool,
    schema: gscInspectUrlInputSchema,
    command: 'gsc',
    buildArgs: buildInspectUrlArgs,
    parse: (out) => parseInspectUrlOutput(out),
  }),
  cli({
    tool: gscAnalyticsRunTool,
    schema: gscAnalyticsRunInputSchema,
    command: 'gsc',
    buildArgs: buildAnalyticsRunArgs,
    parse: (out) => parseAnalyticsRunOutput(out),
  }),
  cli({
    tool: gscIndexCoverageTool,
    schema: gscIndexCoverageInputSchema,
    command: 'gsc',
    buildArgs: buildIndexCoverageArgs,
    parse: (out) => parseIndexCoverageOutput(out),
  }),
  cli({
    tool: gscCannibalizationTool,
    schema: gscCannibalizationInputSchema,
    command: 'gsc',
    buildArgs: buildCannibalizationArgs,
    parse: (out) => parseCannibalizationOutput(out),
  }),
  cli({
    tool: gscOpportunitiesTool,
    schema: gscOpportunitiesInputSchema,
    command: 'gsc',
    buildArgs: buildOpportunitiesArgs,
    parse: (out) => parseOpportunitiesOutput(out),
  }),
  cli({
    tool: gscCTRAnomalyTool,
    schema: gscCTRAnomalyInputSchema,
    command: 'gsc',
    buildArgs: buildCTRAnomalyArgs,
    parse: (out) => parseCTRAnomalyOutput(out),
  }),
  cli({
    tool: gscHealthTool,
    schema: gscHealthInputSchema,
    command: 'gsc',
    buildArgs: buildHealthArgs,
    parse: (out) => parseHealthOutput(out),
  }),

  // ── gsc_monitor_urls: dual-mode (native URL loop OR CLI config run) ─────────
  native({
    tool: gscMonitorUrlsTool,
    schema: gscMonitorUrlsInputSchema,
    run: async (input, exec) => {
      if ('urls' in input) {
        const output = await processUrlArrayMode(input, (site, url) =>
          exec.execute({
            command: 'gsc',
            args: ['inspect', 'url', '--site', site, '--url', url],
          }),
        )
        return { output, isError: !output.success }
      }
      const result = await exec.execute({
        command: 'gsc',
        args: buildMonitorUrlsArgs(input),
      })
      if (!isSuccessExit(result.exitCode)) {
        return { output: mapCLIError(result, 'gsc_monitor_urls'), isError: true }
      }
      return { output: parseMonitorUrlsOutput(result.stdout, input), isError: false }
    },
  }),

  // ── Native tools (no CLI) ───────────────────────────────────────────────────
  native({
    tool: gscTrafficCompareTool,
    schema: gscTrafficCompareInputSchema,
    run: async (input) => {
      const output = await runGscTrafficCompare(input)
      return { output, isError: !output.success }
    },
  }),
  native({
    tool: ga4ConsentHealthTool,
    schema: ga4ConsentHealthInputSchema,
    run: async (input) => {
      const output = await runGa4ConsentHealth(input)
      return { output, isError: !output.success }
    },
  }),
  native({
    tool: seoPageAuditTool,
    schema: seoPageAuditInputSchema,
    run: async (input) => {
      const output = await runSeoPageAudit(input)
      return { output, isError: !output.success }
    },
  }),
  native({
    tool: seoAuditBatchTool,
    schema: seoAuditBatchInputSchema,
    run: async (input) => {
      const output = await runSeoAuditBatch(input)
      return { output, isError: !output.success }
    },
  }),
]

const SPEC_BY_NAME = new Map(SPECS.map((spec) => [spec.tool.name, spec]))

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
