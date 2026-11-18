import { describe, it, expect } from 'vitest'
import { cliFailure, stderrMessage, cleanStderr } from './errors.js'

// stderr samples captured from real runs (2026-11-18), site names replaced.
const GSC_403 = `2026/11/18 07:00:05 INFO GSC client initialized successfully
2026/11/18 07:00:05 INFO querying search analytics site_url=sc-domain:example.com date_range="2026-10-21 to 2026-11-17"
2026/11/18 07:00:06 ERROR search analytics query failed site_url=sc-domain:example.com start_row=0 error="googleapi: Error 403: User does not have sufficient permission for site 'sc-domain:example.com'. See also: https://support.google.com/webmasters/answer/2451999., forbidden"
Error: failed to query search analytics: googleapi: Error 403: User does not have sufficient permission for site 'sc-domain:example.com'. See also: https://support.google.com/webmasters/answer/2451999., forbidden
2026/11/18 07:00:06 INFO GSC client closed`

const GA4_403_USAGE = `Error: failed to list conversions: failed to list conversions for property 123456789: googleapi: Error 403: The caller does not have permission, forbidden
Usage:
  ga4 report [flags]

Flags:
  -a, --all              Report on all projects`

const CONFIG_MISSING = `Error: failed to load config: config not found: mysite (looked in configs/ and configs/examples/) (use --project to specify a config file name)
Usage:
  ga4 link [flags]`

const run = (stderr: string, exitCode = 1) => ({ stdout: '', stderr, exitCode, duration: 1 })

describe('cliFailure (B11)', () => {
  it('maps a Search Console 403 to AUTH_DENIED in the native shape, with the grant hint', () => {
    const f = cliFailure(run(GSC_403), 'gsc_analytics_run')
    expect(f).toMatchObject({ success: false, error: { code: 'AUTH_DENIED', hint: expect.stringMatching(/add the service account/) } })
    expect(f.error.message).toBe("gsc_analytics_run: googleapi: Error 403: User does not have sufficient permission for site 'sc-domain:example.com'. See also: https://support.google.com/webmasters/answer/2451999.")
    expect(f.details.stderr).not.toMatch(/INFO/)
  })

  it('maps a GA4 403 and drops the cobra usage block', () => {
    const f = cliFailure(run(GA4_403_USAGE), 'ga4_report')
    expect(f.error.code).toBe('AUTH_DENIED')
    expect(f.details.stderr).not.toMatch(/Usage:|Flags:/)
  })

  it('classifies a missing config as NOT_FOUND and keeps the reason', () => {
    const f = cliFailure(run(CONFIG_MISSING), 'ga4_link_list')
    expect(f.error).toMatchObject({ code: 'NOT_FOUND', message: expect.stringMatching(/config not found: mysite/) })
  })

  it('falls back to CLI_FAILED with the last meaningful line', () => {
    expect(cliFailure(run('something odd happened'), 't').error).toMatchObject({ code: 'CLI_FAILED', message: 't: something odd happened' })
  })
})

describe('stderrMessage (B10)', () => {
  it('prefers the API error over a trailing INFO log line', () => {
    expect(stderrMessage(GSC_403)).toMatch(/^googleapi: Error 403: User does not have sufficient permission/)
    expect(stderrMessage('2026/11/18 07:00:14 INFO GSC client closed')).toBe('no error output')
    expect(cleanStderr('a\nUsage:\n  x')).toBe('a')
  })
})
