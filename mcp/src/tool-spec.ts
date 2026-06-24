import { z } from 'zod'
import type { CLIExecutor } from './cli/executor.js'

/**
 * The tool registry seam.
 *
 * A tool is one deep module: it owns its MCP definition, input schema, the
 * CLI subcommand it targets (or its native handler), how it builds args, and
 * how it parses output. Tool files assemble their own `ToolSpec` via `cli()` /
 * `native()` and export a single spec; `index.ts` only collects them. This
 * keeps the "what is a tool" contract in one place and out of the consumer.
 */

/** Standard MCP tool annotations (title + behavior hints). */
export interface ToolAnnotations {
  title: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

/** The shape every tool module exports as its MCP definition. */
export interface ToolDef {
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
export interface CliToolSpec {
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
export interface NativeToolSpec {
  kind: 'native'
  tool: ToolDef
  schema: z.ZodType
  run: (input: never, executor: CLIExecutor) => Promise<{ output: unknown; isError: boolean }>
}

export type ToolSpec = CliToolSpec | NativeToolSpec

/** Type-checked CLI spec builder: callbacks are validated against the schema's output type. */
export function cli<S extends z.ZodType>(def: {
  tool: ToolDef
  schema: S
  command: string
  buildArgs: (input: z.infer<S>) => string[]
  parse: (stdout: string, input: z.infer<S>) => unknown
}): CliToolSpec {
  return { kind: 'cli', ...def } as CliToolSpec
}

/** Type-checked native spec builder. */
export function native<S extends z.ZodType>(def: {
  tool: ToolDef
  schema: S
  run: (input: z.infer<S>, executor: CLIExecutor) => Promise<{ output: unknown; isError: boolean }>
}): NativeToolSpec {
  return { kind: 'native', ...def } as NativeToolSpec
}

// Framework convention (see CONTEXT.md, docs/BACKLOG.md "Implementation notes"):
//   exit 0 — clean run, no findings
//   exit 1 — command failed (API error, malformed config, etc.)
//   exit 2 — success with findings (e.g. cannibalising queries detected)
//
// Both 0 and 2 are success at the MCP dispatch layer; the parsed JSON
// envelope tells the caller whether findings exist. Treating 2 as failure
// would swallow stdout — the very report the tool exists to surface.
const SUCCESS_EXIT_CODES = new Set([0, 2])
export const isSuccessExit = (code: number): boolean => SUCCESS_EXIT_CODES.has(code)
