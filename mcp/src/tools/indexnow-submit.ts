import { z } from 'zod'
import { native } from '../tool-spec.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, errorCodeForStatus, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow'
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/
const FETCH_TIMEOUT_MS = 15_000

export const indexnowSubmitInputSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10000).describe('1–10,000 absolute URLs, all on the same host'),
  key: z.string().optional().describe('IndexNow key (8–128 chars of a-z, A-Z, 0-9, -). Falls back to INDEXNOW_KEY.'),
  key_location: z.string().url().optional().describe('URL of the key file. Default: https://<host>/<key>.txt'),
  endpoint: z.string().url().default(DEFAULT_ENDPOINT).describe('IndexNow endpoint to POST to'),
  dry_run: z.boolean().default(true).describe('Validate and show what would be sent, without POSTing (default true)'),
})

export type IndexnowSubmitInput = z.infer<typeof indexnowSubmitInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface IndexnowPayload {
  host: string
  key: string
  keyLocation?: string
  urlList: string[]
}

export type IndexnowSubmitResult =
  | { success: true; dry_run: true; endpoint: string; key_file_verified: true; would_send: IndexnowPayload }
  | {
      success: true
      dry_run: false
      endpoint: string
      key_file_verified: true
      status: number
      outcome: 'accepted' | 'accepted_key_pending'
      submitted: number
      message: string
    }
  | ToolFailureResult

// ============================================================================
// Validation
// ============================================================================

function invalid(message: string, hint?: string): ToolError {
  return new ToolError(ErrorCode.INVALID_INPUT, message, hint)
}

/** All URLs must be http(s) and share one host; returns that host. */
function sameHost(urls: string[]): string {
  const hosts = new Set<string>()
  for (const raw of urls) {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw invalid(`URL is not http(s): ${raw}`, 'IndexNow only accepts http and https URLs.')
    }
    hosts.add(u.hostname.toLowerCase())
  }
  if (hosts.size > 1) {
    throw invalid(
      `All URLs must be on the same host; found ${[...hosts].slice(0, 5).join(', ')}.`,
      'IndexNow accepts one host per request. Submit each host separately.',
    )
  }
  return [...hosts][0]
}

async function verifyKeyFile(keyFileUrl: string, key: string): Promise<void> {
  const hint = `Host a UTF-8 text file at ${keyFileUrl} whose only content is the key, then retry.`
  let res: Response
  try {
    res = await fetch(keyFileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw invalid(`Could not fetch the key file at ${keyFileUrl}: ${err instanceof Error ? err.message : String(err)}`, hint)
  }
  if (!res.ok) throw invalid(`Key file at ${keyFileUrl} returned HTTP ${res.status}.`, hint)
  const body = (await res.text()).trim()
  if (body !== key) throw invalid(`Key file at ${keyFileUrl} does not contain the key.`, hint)
}

const STATUS_ERRORS: Record<number, { code: ErrorCode; message: string; hint: string }> = {
  400: {
    code: ErrorCode.INVALID_INPUT,
    message: 'IndexNow rejected the request as badly formatted (HTTP 400).',
    hint: 'Check that every URL is absolute and the payload is valid JSON.',
  },
  403: {
    code: ErrorCode.AUTH_DENIED,
    message: 'IndexNow reports the key as invalid (HTTP 403).',
    hint: 'Make sure the key file exists on the host and contains exactly the key.',
  },
  422: {
    code: ErrorCode.INVALID_INPUT,
    message: 'IndexNow says the URLs do not belong to the host, or the key does not match the protocol schema (HTTP 422).',
    hint: 'All URLs must belong to the host that serves the key file; a key_location limits which URLs the key covers.',
  },
  429: {
    code: ErrorCode.QUOTA_EXCEEDED,
    message: 'IndexNow rate limit hit: too many requests (HTTP 429).',
    hint: 'Submit only new or changed URLs and avoid resubmitting often.',
  },
}

// ============================================================================
// Handler
// ============================================================================

export async function runIndexnowSubmit(input: IndexnowSubmitInput): Promise<IndexnowSubmitResult> {
  try {
    // `|| undefined`: the MCPB manifest always sets INDEXNOW_KEY, empty when unset.
    const key = input.key ?? (process.env.INDEXNOW_KEY || undefined)
    if (!key) throw invalid('No IndexNow key provided.', 'Pass `key` or set INDEXNOW_KEY.')
    if (!KEY_PATTERN.test(key)) {
      throw invalid('Invalid IndexNow key.', 'The key must be 8–128 characters of a-z, A-Z, 0-9 and "-".')
    }

    const host = sameHost(input.urls)

    let keyFileUrl = `https://${host}/${key}.txt`
    if (input.key_location) {
      const loc = new URL(input.key_location)
      if (loc.protocol !== 'http:' && loc.protocol !== 'https:') throw invalid('key_location must be an http(s) URL.')
      if (loc.hostname.toLowerCase() !== host) {
        throw invalid(`key_location must be on the same host as the URLs (${host}).`, 'IndexNow requires the key file on the host being submitted.')
      }
      keyFileUrl = input.key_location
    }
    await verifyKeyFile(keyFileUrl, key)

    const payload: IndexnowPayload = {
      host,
      key,
      ...(input.key_location ? { keyLocation: input.key_location } : {}),
      urlList: input.urls,
    }

    if (input.dry_run) {
      return { success: true, dry_run: true, endpoint: input.endpoint, key_file_verified: true, would_send: payload }
    }

    const res = await fetch(input.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (res.status === 200 || res.status === 202) {
      return {
        success: true,
        dry_run: false,
        endpoint: input.endpoint,
        key_file_verified: true,
        status: res.status,
        outcome: res.status === 200 ? 'accepted' : 'accepted_key_pending',
        submitted: input.urls.length,
        message:
          res.status === 200
            ? 'URLs received. This only confirms receipt, not indexing.'
            : 'URLs received; IndexNow key validation is still pending.',
      }
    }
    const mapped = STATUS_ERRORS[res.status]
    if (mapped) return errorResult(mapped.code, mapped.message, mapped.hint)
    return errorResult(errorCodeForStatus(res.status), `IndexNow returned unexpected HTTP ${res.status}.`)
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const indexnowSubmitTool = {
  name: 'indexnow_submit',
  description:
    'Use right after publishing or updating pages to tell search engines to re-crawl them via IndexNow. ' +
    'Notifies Bing, Yandex, Seznam, Naver, Yep and others that participate in IndexNow — NOT Google (use gsc_sitemaps_submit or Search Console for Google). ' +
    'Takes 1–10,000 URLs on one host; the key (param or INDEXNOW_KEY) must be hosted as <key>.txt on that host (or at key_location) and is verified before submitting. ' +
    'dry_run defaults to true: it validates and returns the payload without POSTing — set dry_run=false to actually submit. ' +
    'A 200/202 answer only confirms receipt, not indexing.',
  inputSchema: {
    type: 'object',
    required: ['urls'],
    properties: {
      urls: { type: 'array', items: { type: 'string' }, description: '1–10,000 absolute URLs, all on the same host' },
      key: { type: 'string', description: 'IndexNow key, 8–128 chars of a-z A-Z 0-9 -. Defaults to INDEXNOW_KEY.' },
      key_location: { type: 'string', description: 'URL of the key file (default https://<host>/<key>.txt)' },
      endpoint: { type: 'string', description: `IndexNow endpoint (default ${DEFAULT_ENDPOINT})` },
      dry_run: { type: 'boolean', description: 'Validate and preview without POSTing (default true)' },
    },
  },
  annotations: { title: 'Submit URLs to IndexNow', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
}

export const indexnowSubmitSpec = native({
  tool: indexnowSubmitTool,
  schema: indexnowSubmitInputSchema,
  run: async (input) => {
    const output = await runIndexnowSubmit(input)
    return { output, isError: !output.success }
  },
})
