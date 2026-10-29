import { z } from 'zod'
import { native } from '../tool-spec.js'
import { adsenseGet } from '../utils/adsense-client.js'
import {
  ToolError,
  toolErrorToFailure,
  errorResult,
  ErrorCode,
  type ToolFailureResult,
} from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const adsenseAccountsListInputSchema = z.object({})

export type AdsenseAccountsListInput = z.infer<typeof adsenseAccountsListInputSchema>

// ============================================================================
// Types (subset of the AdSense Account resource we surface)
// ============================================================================

/** One AdSense account as returned by accounts.list. */
export interface AdsenseAccount {
  /** Resource name, e.g. "accounts/pub-1234567890123456". Use this as the account id for reports. */
  name: string
  /** Human-readable display name. */
  displayName?: string
  /** Account time zone, e.g. { id: "America/Los_Angeles" }. */
  timeZone?: { id?: string }
  createTime?: string
  /** Whether this is a premium account. */
  premium?: boolean
  /** Account state, e.g. "READY". */
  state?: string
}

interface AccountsListResponse {
  accounts?: AdsenseAccount[]
  nextPageToken?: string
}

export type AdsenseAccountsListResult =
  | { success: true; accounts: AdsenseAccount[] }
  | ToolFailureResult

// ============================================================================
// Handler
// ============================================================================

/**
 * List the AdSense accounts the authenticated identity can access. The returned
 * `name` ("accounts/pub-...") is the account id every other AdSense tool needs.
 *
 * Pages through all results (accounts.list is rarely more than one page, but a
 * publisher with managed accounts can have several).
 */
export async function runAdsenseAccountsList(): Promise<AdsenseAccountsListResult> {
  try {
    const accounts: AdsenseAccount[] = []
    let pageToken: string | undefined

    do {
      const data = await adsenseGet<AccountsListResponse>('accounts', {
        pageSize: '50',
        pageToken,
      })
      if (data.accounts) accounts.push(...data.accounts)
      pageToken = data.nextPageToken
    } while (pageToken)

    if (accounts.length === 0) {
      return errorResult(
        ErrorCode.NOT_FOUND,
        'No AdSense accounts are accessible to the authenticated identity.',
        'Confirm the signed-in Google account owns an AdSense account, and that the credential consented the adsense.readonly scope.',
      )
    }

    return { success: true, accounts }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(
      ErrorCode.UPSTREAM_5XX,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const adsenseAccountsListTool = {
  name: 'adsense_accounts_list',
  description:
    'Use first when the user asks about AdSense earnings/revenue on their own site. ' +
    'Lists the AdSense publisher accounts the authenticated user can access. ' +
    'Returns each account name (accounts/pub-XXXXXXXXXXXXXXXX) — pass that name as ' +
    'the `account` argument to adsense_report. No parameters. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  annotations: { title: 'List AdSense accounts', readOnlyHint: true },
}

export const adsenseAccountsListSpec = native({
  tool: adsenseAccountsListTool,
  schema: adsenseAccountsListInputSchema,
  run: async () => {
    const output = await runAdsenseAccountsList()
    return { output, isError: !output.success }
  },
})
