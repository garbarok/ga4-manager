import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialsFromEnv, CREDENTIALS_B64_ENV } from './credentials-env.js'

const KEY = { type: 'service_account', client_email: 'bot@example.iam.gserviceaccount.com', private_key: 'x' }
const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64')

describe('credentialsFromEnv', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'creds-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('does nothing when the variable is unset', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(credentialsFromEnv(env, join(dir, 'out'))).toEqual({ status: 'unset' })
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
  })

  it('writes the decoded JSON to a private file and points GOOGLE_APPLICATION_CREDENTIALS at it', () => {
    const env: NodeJS.ProcessEnv = { [CREDENTIALS_B64_ENV]: b64(KEY) }
    const out = join(dir, 'out')
    const result = credentialsFromEnv(env, out)
    expect(result.status).toBe('written')
    if (result.status !== 'written') return
    expect(result.type).toBe('service_account')
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(result.path)
    expect(JSON.parse(readFileSync(result.path, 'utf8'))).toEqual(KEY)
    expect(statSync(result.path).mode & 0o777).toBe(0o600)
    expect(statSync(out).mode & 0o777).toBe(0o700)
  })

  it('is idempotent: the same value maps to the same file', () => {
    const out = join(dir, 'out')
    const a = credentialsFromEnv({ [CREDENTIALS_B64_ENV]: b64(KEY) }, out)
    const b = credentialsFromEnv({ [CREDENTIALS_B64_ENV]: b64(KEY) }, out)
    expect(a).toEqual(b)
  })

  it('keeps a GOOGLE_APPLICATION_CREDENTIALS that names a readable file', () => {
    const file = join(dir, 'adc.json')
    writeFileSync(file, '{"type":"authorized_user"}')
    const env: NodeJS.ProcessEnv = { [CREDENTIALS_B64_ENV]: b64(KEY), GOOGLE_APPLICATION_CREDENTIALS: file }
    expect(credentialsFromEnv(env, join(dir, 'out'))).toEqual({ status: 'file_in_use', path: file })
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(file)
  })

  it('replaces a GOOGLE_APPLICATION_CREDENTIALS that points at a missing file', () => {
    const env: NodeJS.ProcessEnv = { [CREDENTIALS_B64_ENV]: b64(KEY), GOOGLE_APPLICATION_CREDENTIALS: join(dir, 'missing.json') }
    const result = credentialsFromEnv(env, join(dir, 'out'))
    expect(result.status).toBe('written')
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toMatch(/credentials-[0-9a-f]{12}\.json$/)
  })

  it('rejects a value that is not base64 JSON, leaving the environment unchanged', () => {
    const env: NodeJS.ProcessEnv = { [CREDENTIALS_B64_ENV]: 'not json at all' }
    const result = credentialsFromEnv(env, join(dir, 'out'))
    expect(result.status).toBe('invalid')
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined()
  })

  it('rejects JSON without a credential type', () => {
    const result = credentialsFromEnv({ [CREDENTIALS_B64_ENV]: b64({ hello: 'world' }) }, join(dir, 'out'))
    expect(result).toMatchObject({ status: 'invalid' })
  })
})
