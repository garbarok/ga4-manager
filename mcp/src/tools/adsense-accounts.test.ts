import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adsenseGet } from '../utils/adsense-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import {
  adsenseAccountsListTool,
  adsenseAccountsListSpec,
  runAdsenseAccountsList,
} from './adsense-accounts.js'

vi.mock('../utils/adsense-client.js', () => ({
  adsenseGet: vi.fn(),
}))

const mockGet = vi.mocked(adsenseGet)

beforeEach(() => {
  mockGet.mockReset()
})

describe('runAdsenseAccountsList', () => {
  it('returns the accounts on success', async () => {
    mockGet.mockResolvedValueOnce({
      accounts: [{ name: 'accounts/pub-123', displayName: 'My Site', state: 'READY' }],
    } as never)

    const result = await runAdsenseAccountsList()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.accounts).toHaveLength(1)
      expect(result.accounts[0].name).toBe('accounts/pub-123')
    }
  })

  it('follows pagination and concatenates pages', async () => {
    mockGet
      .mockResolvedValueOnce({
        accounts: [{ name: 'accounts/pub-1' }],
        nextPageToken: 'tok',
      } as never)
      .mockResolvedValueOnce({ accounts: [{ name: 'accounts/pub-2' }] } as never)

    const result = await runAdsenseAccountsList()
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(result.success && result.accounts.map((a) => a.name)).toEqual([
      'accounts/pub-1',
      'accounts/pub-2',
    ])
  })

  it('returns NOT_FOUND when no accounts are accessible', async () => {
    mockGet.mockResolvedValueOnce({} as never)
    const result = await runAdsenseAccountsList()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('converts a thrown ToolError into a failure result', async () => {
    mockGet.mockRejectedValueOnce(new ToolError(ErrorCode.AUTH_DENIED, 'nope', 'fix it'))
    const result = await runAdsenseAccountsList()
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.AUTH_DENIED)
      expect(result.error.hint).toBe('fix it')
    }
  })
})

describe('adsenseAccountsListTool definition', () => {
  it('is read-only and takes no params', () => {
    expect(adsenseAccountsListTool.name).toBe('adsense_accounts_list')
    expect(adsenseAccountsListTool.annotations.readOnlyHint).toBe(true)
    expect(adsenseAccountsListTool.inputSchema.properties).toEqual({})
  })

  it('reports isError via the spec when the call fails', async () => {
    mockGet.mockResolvedValueOnce({} as never)
    const { isError } = await adsenseAccountsListSpec.run({} as never, {} as never)
    expect(isError).toBe(true)
  })
})
