import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest, DataforseoTaskError } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

/** Path relative to /v3/: lowercase segments joined by "/", e.g. "serp/google/organic/live/advanced". */
const PATH_PATTERN = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/

export const dataforseoRequestInputSchema = z.object({
  path: z
    .string()
    .regex(PATH_PATTERN, 'path must be relative to /v3/ — lowercase letters, digits and "_" in "/"-separated segments, no leading slash, ".." or query string')
    .describe('Endpoint path after /v3/, e.g. "dataforseo_labs/google/related_keywords/live"'),
  method: z.enum(['GET', 'POST']).optional().default('POST').describe('HTTP method (default POST)'),
  task: z.record(z.string(), z.unknown()).optional().describe('Task object sent as the request body for POST (wrapped in a one-item array)'),
  max_items: z.number().int().min(1).max(1000).optional().default(100).describe('Max result items to return (default 100, max 1000)'),
})

export type DataforseoRequestInput = z.infer<typeof dataforseoRequestInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export type DataforseoRequestResult =
  | { success: true; path: string; items: unknown[]; item_count: number; truncated: boolean; cost_usd: number | null }
  | (ToolFailureResult & { cost_usd?: number | null })

// ============================================================================
// Gate
// ============================================================================

/** Raw access bills arbitrary endpoints, so it stays off until the owner opts in. */
function rawAccessAllowed(): boolean {
  const flag = (process.env.DATAFORSEO_ALLOW_RAW || '').trim().toLowerCase()
  return flag === '1' || flag === 'true'
}

/**
 * Async task endpoints answer 20100 "Task Created" (billed) and need a hyphenated task id this tool's
 * path pattern cannot express, so they would bill a task whose results are unreachable. Live endpoints only.
 */
const TASK_SEGMENTS = new Set(['task_post', 'task_get', 'tasks_ready'])

function isTaskPath(path: string): boolean {
  return path.split('/').some((segment) => TASK_SEGMENTS.has(segment))
}

// ============================================================================
// Truncation
// ============================================================================

/**
 * Cap the response at `max` items. Most endpoints return one result object that wraps the rows in
 * `result[0].items`, so those nested arrays are what gets counted and sliced; a result without an
 * `items` array counts as one item itself.
 */
function truncateResults(results: unknown[], max: number): { items: unknown[]; itemCount: number; truncated: boolean } {
  let remaining = max
  let total = 0
  const out: unknown[] = []
  for (const result of results) {
    const nested = (result as { items?: unknown } | null)?.items
    if (Array.isArray(nested)) {
      total += nested.length
      const kept = nested.slice(0, remaining)
      remaining -= kept.length
      out.push({ ...(result as object), items: kept })
    } else {
      total += 1
      if (remaining > 0) {
        out.push(result)
        remaining -= 1
      }
    }
  }
  return { items: out, itemCount: total, truncated: total > max }
}

// ============================================================================
// Handler
// ============================================================================

export async function runDataforseoRequest(input: DataforseoRequestInput): Promise<DataforseoRequestResult> {
  if (!rawAccessAllowed()) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'dataforseo_request is disabled: raw DataForSEO access bills any endpoint and is opt-in.',
      'Set DATAFORSEO_ALLOW_RAW=1 (or "Allow raw DataForSEO requests" in the extension settings), or use a specialised tool (keyword_volume, ranked_keywords, backlinks_overview...).',
    )
  }
  if (isTaskPath(input.path)) {
    return errorResult(
      ErrorCode.INVALID_INPUT,
      'dataforseo_request supports live and GET endpoints only; task_post would bill a task whose results this tool cannot fetch.',
      'Use the /live/ variant of the endpoint.',
    )
  }
  try {
    const { items, cost } = await dataforseoRequest<unknown>({ method: input.method, path: input.path, task: input.task })
    const cut = truncateResults(items, input.max_items)
    return { success: true, path: input.path, items: cut.items, item_count: cut.itemCount, truncated: cut.truncated, cost_usd: cost }
  } catch (err) {
    if (err instanceof DataforseoTaskError) return { ...toolErrorToFailure(err), cost_usd: err.cost }
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const dataforseoRequestTool = {
  name: 'dataforseo_request',
  description:
    'Escape hatch: call any DataForSEO v3 endpoint by path. Prefer the specialised tools (keyword_volume, ranked_keywords, backlinks_overview, ...) ' +
    'and use this only for endpoints they do not cover. Every call is billed — check dataforseo_balance first. ' +
    'Live and GET endpoints only (no task_post/task_get). Disabled unless DATAFORSEO_ALLOW_RAW=1. Takes path (relative to /v3/), method (GET|POST, default POST), task (request body object) ' +
    'and max_items (default 100, max 1000). Returns items, item_count, truncated and cost_usd (null when DataForSEO reports no cost; also set on task failures).',
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Endpoint path after /v3/, e.g. "dataforseo_labs/google/related_keywords/live"' },
      method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method (default POST)', default: 'POST' },
      task: { type: 'object', description: 'Task object sent as the request body for POST' },
      max_items: { type: 'number', description: 'Max result items to return (default 100, max 1000)', default: 100 },
    },
  },
  annotations: { title: 'DataForSEO raw request (billed)', readOnlyHint: true, openWorldHint: true },
}

export const dataforseoRequestSpec = native({
  tool: dataforseoRequestTool,
  schema: dataforseoRequestInputSchema,
  run: async (input) => {
    const output = await runDataforseoRequest(input)
    return { output, isError: !output.success }
  },
})
