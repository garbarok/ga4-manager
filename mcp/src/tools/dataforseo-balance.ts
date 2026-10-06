import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, toolErrorToFailure, errorResult, ErrorCode, type ToolFailureResult } from '../utils/errors.js'

// ============================================================================
// Input Schema
// ============================================================================

export const dataforseoBalanceInputSchema = z.object({})

export type DataforseoBalanceInput = z.infer<typeof dataforseoBalanceInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export type DataforseoBalanceResult =
  | { success: true; login: string | null; balance_usd: number; total_deposited_usd: number | null; cost_usd: 0 }
  | ToolFailureResult

// ============================================================================
// DataForSEO result shape (subset)
// ============================================================================

interface UserDataResult {
  login?: string | null
  money?: { total?: number | null; balance?: number | null } | null
}

// ============================================================================
// Handler
// ============================================================================

export async function runDataforseoBalance(): Promise<DataforseoBalanceResult> {
  try {
    const { items } = await dataforseoRequest<UserDataResult>({ method: 'GET', path: 'appendix/user_data' })
    const balance = items[0]?.money?.balance
    if (typeof balance !== 'number') {
      return errorResult(ErrorCode.UPSTREAM_5XX, 'DataForSEO user data did not include an account balance.')
    }
    return {
      success: true,
      login: items[0]?.login ?? null,
      balance_usd: balance,
      total_deposited_usd: items[0]?.money?.total ?? null,
      // appendix/user_data is not billed.
      cost_usd: 0,
    }
  } catch (err) {
    if (err instanceof ToolError) return toolErrorToFailure(err)
    return errorResult(ErrorCode.UPSTREAM_5XX, err instanceof Error ? err.message : String(err))
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const dataforseoBalanceTool = {
  name: 'dataforseo_balance',
  description:
    'Use before spending DataForSEO credit (keyword_gap, llm_mentions, backlinks_overview, link_gap, ranked_keywords, keyword_ideas, keyword_volume, keyword_serp_snapshot) ' +
    'to check how much balance is left. Free — DataForSEO does not bill this endpoint. Needs DATAFORSEO_USERNAME/DATAFORSEO_PASSWORD. ' +
    'Returns balance_usd, total_deposited_usd and the account login.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { title: 'DataForSEO balance', readOnlyHint: true, openWorldHint: true },
}

export const dataforseoBalanceSpec = native({
  tool: dataforseoBalanceTool,
  schema: dataforseoBalanceInputSchema,
  run: async () => {
    const output = await runDataforseoBalance()
    return { output, isError: !output.success }
  },
})
