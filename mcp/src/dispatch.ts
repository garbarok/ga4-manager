import type { CLIExecutor } from './cli/executor.js'
import { isSuccessExit } from './tool-spec.js'
import { SPEC_BY_NAME } from './registry.js'
import { checkWriteGate } from './write-gate.js'
import { mapCLIError } from './utils/errors.js'
import { contextFromArgs, runWithContext, type ToolContext } from './utils/tool-context.js'
import { logResearch } from './utils/project-context-store.js'

/**
 * One tool call, the same way for every front end: the MCP server
 * (src/index.ts) and the `ga4m` command line (src/cli.ts) both call this, so a
 * tool behaves identically whichever way it is reached (ADR-0006).
 *
 * Around the tool itself it:
 *   - applies the write gate (GA4M_READ_ONLY / GA4M_ALLOW_DESTRUCTIVE);
 *   - validates input with the tool's zod schema;
 *   - opens a ToolContext (site, state dir) that the DataForSEO client uses
 *     for the lookup cache and to record billed requests;
 *   - afterwards appends billed lookups to the site's research log and adds a
 *     `cache` block to the output when any lookup was served from cache.
 */

export interface DispatchResult {
  output: unknown
  isError: boolean
}

export interface CacheReport {
  hits: number
  misses: number
  /** When each cached result was originally bought. */
  cached_at: string[]
  note: string
}

export interface ResearchLogReport {
  site: string | null
  appended: number
  note?: string
}

export async function dispatchTool(
  name: string,
  args: unknown,
  executor: CLIExecutor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DispatchResult> {
  try {
    const spec = SPEC_BY_NAME.get(name)
    if (!spec) throw new Error(`Unknown tool: ${name}`)

    const gate = checkWriteGate(spec.tool.annotations, env)
    if (!gate.allowed) return { output: gate.failure, isError: true }

    const input = spec.schema.parse(args ?? {}) as never
    const ctx = contextFromArgs(name, args, env)

    const result = await runWithContext(ctx, async (): Promise<DispatchResult> => {
      if (spec.kind === 'native') return spec.run(input, executor)
      const run = await executor.execute({ command: spec.command, args: spec.buildArgs(input), timeout: spec.timeoutMs })
      if (!isSuccessExit(run.exitCode)) return { output: mapCLIError(run, name), isError: true }
      return { output: spec.parse(run.stdout, input), isError: false }
    })

    return { output: decorate(result.output, ctx), isError: result.isError }
  } catch (error) {
    return {
      output: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      isError: true,
    }
  }
}

/** Add cache/research-log facts to an object result; leave other shapes alone. */
export function decorate(output: unknown, ctx: ToolContext, now: Date = new Date()): unknown {
  if (ctx.lookups.length === 0) return output

  const hits = ctx.lookups.filter((l) => l.from_cache)
  const billed = ctx.lookups.filter((l) => !l.from_cache)

  let research: ResearchLogReport
  if (billed.length === 0) research = { site: ctx.site, appended: 0 }
  else if (ctx.site) research = { site: ctx.site, appended: logResearch(ctx.stateDir, ctx.site, ctx.tool, billed, now) }
  else {
    research = {
      site: null,
      appended: 0,
      note: 'Paid lookups were not logged: the input names no site. Pass `site`, or set GA4M_DEFAULT_SITE.',
    }
  }

  if (!output || typeof output !== 'object' || Array.isArray(output)) return output

  const extra: Record<string, unknown> = { research_log: research }
  if (hits.length > 0) {
    const cache: CacheReport = {
      hits: hits.length,
      misses: billed.length,
      cached_at: [...new Set(hits.map((h) => h.cached_at ?? ''))].filter(Boolean),
      note: `${hits.length} of ${ctx.lookups.length} DataForSEO lookups came from the local cache at no cost. Pass refresh_cache: true to buy fresh data.`,
    }
    extra.cache = cache
  }
  return { ...(output as Record<string, unknown>), ...extra }
}
