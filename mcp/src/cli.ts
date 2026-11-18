#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { CLIExecutor } from './cli/executor.js'
import { SPECS, SPEC_BY_NAME } from './registry.js'
import { dispatchTool } from './dispatch.js'
import { resolveBinaryPath, readServerVersion } from './binary.js'
import type { ToolDef } from './tool-spec.js'

/**
 * `ga4m`: every MCP tool as a command-line command (ADR-0006).
 *
 *   ga4m list                                  list tools
 *   ga4m help <tool>                           description + flags
 *   ga4m <tool> [--field value ...]            run a tool, print its JSON result
 *   ga4m <tool> --input '{"field": ...}'       same, input as JSON
 *   ga4m <tool> --input-file input.json
 *
 * Tool names accept dashes or underscores (site-audit-run = site_audit_run).
 * Flags are coerced with the tool's input schema: numbers, booleans
 * (`--flag`, `--flag=false`), arrays (comma-separated or repeated), objects
 * (JSON). Output is the tool's JSON result on stdout, identical to what the
 * MCP tool returns. Exit 0 on success, 1 when the tool reports an error,
 * 64 on a usage error.
 */

export const EXIT_OK = 0
export const EXIT_TOOL_ERROR = 1
export const EXIT_USAGE = 64

interface JsonSchemaProp {
  type?: string | string[]
  items?: { type?: string }
  description?: string
  enum?: unknown[]
  default?: unknown
}

export class UsageError extends Error {}

export function toolName(raw: string): string {
  return raw.replace(/-/g, '_')
}

function propsOf(tool: ToolDef): Record<string, JsonSchemaProp> {
  return ((tool.inputSchema as { properties?: Record<string, JsonSchemaProp> }).properties ?? {})
}

function coerce(raw: string, prop: JsonSchemaProp | undefined, flag: string): unknown {
  const type = Array.isArray(prop?.type) ? prop?.type[0] : prop?.type
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(raw)
      if (!Number.isFinite(n)) throw new UsageError(`--${flag} expects a number, got "${raw}"`)
      return n
    }
    case 'boolean':
      if (raw === 'true' || raw === '1' || raw === '') return true
      if (raw === 'false' || raw === '0') return false
      throw new UsageError(`--${flag} expects true or false, got "${raw}"`)
    case 'array': {
      if (raw.trim().startsWith('[')) return JSON.parse(raw)
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
      const itemType = prop?.items?.type
      if (itemType === 'object') return parts.map((p) => JSON.parse(p))
      return itemType === 'number' || itemType === 'integer' ? parts.map(Number) : parts
    }
    case 'object':
      try {
        return JSON.parse(raw)
      } catch {
        throw new UsageError(`--${flag} expects JSON, got "${raw}"`)
      }
    default:
      return raw
  }
}

/** Turn argv (after the tool name) into the tool's input object. */
export function parseToolArgs(tool: ToolDef, argv: string[]): Record<string, unknown> {
  const props = propsOf(tool)
  let input: Record<string, unknown> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new UsageError(`Unexpected argument "${arg}". Flags look like --field value.`)
    let [flag, value] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined]
    if (flag === 'input' || flag === 'input-file') {
      if (value === undefined) value = argv[++i]
      if (value === undefined) throw new UsageError(`--${flag} needs a value`)
      const text = flag === 'input' ? value : readFileSync(value, 'utf8')
      try {
        input = { ...input, ...(JSON.parse(text) as Record<string, unknown>) }
      } catch {
        throw new UsageError(`--${flag} is not valid JSON`)
      }
      continue
    }
    const field = flag.replace(/-/g, '_')
    const prop = props[field]
    if (!prop) throw new UsageError(`${tool.name} has no input "${field}". Run: ga4m help ${tool.name}`)
    const isBool = prop.type === 'boolean'
    if (value === undefined) {
      const next = argv[i + 1]
      if (isBool && (next === undefined || next.startsWith('--'))) value = ''
      else if (next === undefined) throw new UsageError(`--${flag} needs a value`)
      else value = argv[++i]
    }
    const coerced = coerce(value, prop, flag)
    if (prop.type === 'array' && Array.isArray(input[field]) && !value.trim().startsWith('[')) {
      input[field] = [...(input[field] as unknown[]), ...(coerced as unknown[])]
    } else {
      input[field] = coerced
    }
  }
  return input
}

export function helpFor(tool: ToolDef): string {
  const props = propsOf(tool)
  const required = new Set(((tool.inputSchema as { required?: string[] }).required) ?? [])
  const lines = [`ga4m ${tool.name.replace(/_/g, '-')}`, '', tool.description, '', 'Flags:']
  for (const [name, p] of Object.entries(props)) {
    const type = Array.isArray(p.type) ? p.type.join('|') : (p.type ?? 'string')
    const extra = [
      required.has(name) ? 'required' : null,
      p.enum ? `one of ${p.enum.join(', ')}` : null,
      p.default !== undefined ? `default ${JSON.stringify(p.default)}` : null,
    ].filter(Boolean)
    lines.push(`  --${name.replace(/_/g, '-')} <${type}>${extra.length ? ` (${extra.join('; ')})` : ''}`)
    if (p.description) lines.push(`      ${p.description}`)
  }
  lines.push('  --input <json> / --input-file <path>   whole input as JSON')
  return lines.join('\n')
}

const USAGE = `ga4m ${readServerVersion()} — every GA4 Manager MCP tool from the command line

Usage:
  ga4m list                       list tools
  ga4m help <tool>                show a tool's description and flags
  ga4m <tool> [--flag value ...]  run a tool and print its JSON result
  ga4m --version

Examples:
  ga4m server-info
  ga4m site-audit-run --start-url https://example.com/ --max-pages 200
  ga4m project-context-get --site example.com
`

export interface Writer {
  write(text: string): unknown
}

export async function main(argv: string[], out: Writer = process.stdout, err: Writer = process.stderr): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      out.write(USAGE)
      return cmd ? EXIT_OK : EXIT_USAGE
    }
    if (cmd === '--version' || cmd === 'version') {
      out.write(`${readServerVersion()}\n`)
      return EXIT_OK
    }
    if (cmd === '__site-audit-worker') {
      // Internal: the detached background process started by site_audit_run.
      const [stateDir, site, id] = rest
      if (!stateDir || !site || !id) throw new UsageError('__site-audit-worker <state_dir> <site> <id>')
      const { runAuditJob } = await import('./audit/audit-job.js')
      const rec = await runAuditJob(stateDir, site, id)
      return rec.status === 'done' ? EXIT_OK : EXIT_TOOL_ERROR
    }
    if (cmd === 'list') {
      for (const spec of SPECS) out.write(`${spec.tool.name.replace(/_/g, '-').padEnd(30)} ${spec.tool.annotations?.title ?? ''}\n`)
      return EXIT_OK
    }
    if (cmd === 'help') {
      const spec = rest[0] ? SPEC_BY_NAME.get(toolName(rest[0])) : undefined
      if (!spec) throw new UsageError(`Unknown tool "${rest[0] ?? ''}". Run: ga4m list`)
      out.write(helpFor(spec.tool) + '\n')
      return EXIT_OK
    }
    const spec = SPEC_BY_NAME.get(toolName(cmd))
    if (!spec) throw new UsageError(`Unknown command or tool "${cmd}". Run: ga4m list`)
    if (rest.includes('--help') || rest.includes('-h')) {
      out.write(helpFor(spec.tool) + '\n')
      return EXIT_OK
    }
    const input = parseToolArgs(spec.tool, rest)
    const executor = new CLIExecutor(resolveBinaryPath())
    const { output, isError } = await dispatchTool(spec.tool.name, input, executor)
    out.write(JSON.stringify(output, null, 2) + '\n')
    return isError ? EXIT_TOOL_ERROR : EXIT_OK
  } catch (e) {
    if (e instanceof UsageError) {
      err.write(`ga4m: ${e.message}\n`)
      return EXIT_USAGE
    }
    err.write(`ga4m: ${e instanceof Error ? e.message : String(e)}\n`)
    return EXIT_TOOL_ERROR
  }
}

// Run only as the entry point, not when imported by tests or the worker launcher.
const entry = process.argv[1] ?? ''
if (/[\\/]cli\.(js|ts)$/.test(entry) || /[\\/]ga4m$/.test(entry)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
