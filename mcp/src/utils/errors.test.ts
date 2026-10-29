import { describe, it, expect } from 'vitest'
import { errorCodeForStatus, ErrorCode } from './errors.js'

describe('errorCodeForStatus', () => {
  it.each([
    [400, ErrorCode.INVALID_INPUT],
    [401, ErrorCode.AUTH_DENIED],
    [403, ErrorCode.AUTH_DENIED],
    [404, ErrorCode.NOT_FOUND],
    [422, ErrorCode.INVALID_INPUT],
    [429, ErrorCode.QUOTA_EXCEEDED],
    [500, ErrorCode.UPSTREAM_5XX],
    [503, ErrorCode.UPSTREAM_5XX],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code)
  })
})
