import { ToolError, ErrorCode } from './errors.js'

/**
 * Per-session spending cap for paid APIs (DataForSEO, ValueSERP, Cloudflare
 * Browser Rendering). State lives in this server process, so it resets when
 * the MCP client restarts the server.
 *
 * Two limits, both checked before every paid request:
 *   GA4M_MAX_SPEND_USD   — DataForSEO dollars actually billed (default 5)
 *   GA4M_MAX_PAID_CALLS  — paid requests of any provider (default 300)
 * Set either to "off" to disable it. The dollar cap is checked before a call
 * and the cost is known only after it, so one call can overshoot it.
 *
 * The point is to bound what a prompt-injected or looping agent can spend:
 * pages fetched by the audit tools are untrusted text the agent reads.
 */

export type PaidProvider = 'dataforseo' | 'valueserp' | 'cloudflare'

export const DEFAULT_MAX_SPEND_USD = 5
export const DEFAULT_MAX_PAID_CALLS = 300

export interface SpendLimits {
  max_spend_usd: number | null
  max_paid_calls: number | null
}

export interface SpendSummary extends SpendLimits {
  spent_usd: number
  paid_calls: number
  calls_by_provider: Record<PaidProvider, number>
}

let spentUsd = 0
let paidCalls = 0
const callsByProvider: Record<PaidProvider, number> = { dataforseo: 0, valueserp: 0, cloudflare: 0 }

function parseLimit(raw: string | undefined, name: string, fallback: number): number | null {
  const value = raw?.trim()
  if (!value) return fallback
  if (value.toLowerCase() === 'off') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new ToolError(ErrorCode.INVALID_INPUT, `${name} must be a non-negative number or "off", got "${value}".`)
  }
  return n
}

export function readSpendLimits(env: NodeJS.ProcessEnv = process.env): SpendLimits {
  return {
    max_spend_usd: parseLimit(env.GA4M_MAX_SPEND_USD, 'GA4M_MAX_SPEND_USD', DEFAULT_MAX_SPEND_USD),
    max_paid_calls: parseLimit(env.GA4M_MAX_PAID_CALLS, 'GA4M_MAX_PAID_CALLS', DEFAULT_MAX_PAID_CALLS),
  }
}

/** Refuse the call when a limit is already reached; otherwise count it. */
export function beforePaidCall(provider: PaidProvider, env: NodeJS.ProcessEnv = process.env): void {
  const { max_spend_usd, max_paid_calls } = readSpendLimits(env)
  if (max_paid_calls !== null && paidCalls >= max_paid_calls) {
    throw new ToolError(
      ErrorCode.QUOTA_EXCEEDED,
      `Session limit of ${max_paid_calls} paid API calls reached (${provider} call refused).`,
      'Restart the MCP server to reset the counter, or raise GA4M_MAX_PAID_CALLS ("off" disables it). If you did not expect this many calls, check whether a fetched page told the agent to loop.',
    )
  }
  if (max_spend_usd !== null && spentUsd >= max_spend_usd) {
    throw new ToolError(
      ErrorCode.QUOTA_EXCEEDED,
      `Session spending cap of $${max_spend_usd} reached ($${round(spentUsd)} billed; ${provider} call refused).`,
      'Restart the MCP server to reset the counter, or raise GA4M_MAX_SPEND_USD ("off" disables it).',
    )
  }
  paidCalls += 1
  callsByProvider[provider] += 1
}

/** Add the USD a provider reported for a call (null when unknown). */
export function recordSpend(costUsd: number | null): void {
  if (typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd > 0) spentUsd += costUsd
}

export function spendSummary(env: NodeJS.ProcessEnv = process.env): SpendSummary {
  return { ...readSpendLimits(env), spent_usd: round(spentUsd), paid_calls: paidCalls, calls_by_provider: { ...callsByProvider } }
}

/** Reset the counters. For tests. */
export function resetSpend(): void {
  spentUsd = 0
  paidCalls = 0
  for (const k of Object.keys(callsByProvider) as PaidProvider[]) callsByProvider[k] = 0
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
