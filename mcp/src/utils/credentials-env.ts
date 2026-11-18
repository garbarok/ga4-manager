import { accessSync, constants, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Google credentials passed as an environment variable.
 *
 * Cloud sessions, CI and scheduled jobs hold settings as environment
 * variables, not files, but every Google client here (this server and the ga4
 * binary it spawns) reads GOOGLE_APPLICATION_CREDENTIALS as a file path. When
 * GA4_CREDENTIALS_B64 holds a base64-encoded credential JSON (a service-account
 * key or an ADC `authorized_user` file), the server writes it to a private file
 * once at startup and points GOOGLE_APPLICATION_CREDENTIALS at it.
 *
 * A GOOGLE_APPLICATION_CREDENTIALS that already names a readable file wins:
 * the variable is only a fallback. A bad value is reported and ignored, so the
 * server still starts and server_info explains what is missing.
 */
export const CREDENTIALS_B64_ENV = 'GA4_CREDENTIALS_B64'

export type CredentialsFromEnv =
  | { status: 'unset' }
  | { status: 'file_in_use'; path: string }
  | { status: 'written'; path: string; type: string }
  | { status: 'invalid'; problem: string }

export function credentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  dir: string = defaultDir(),
): CredentialsFromEnv {
  const raw = env[CREDENTIALS_B64_ENV]?.trim()
  if (!raw) return { status: 'unset' }

  const current = env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  if (current && isReadable(current)) return { status: 'file_in_use', path: current }

  let json: string
  let type: unknown
  try {
    json = Buffer.from(raw, 'base64').toString('utf8')
    type = (JSON.parse(json) as { type?: unknown }).type
  } catch {
    return { status: 'invalid', problem: `${CREDENTIALS_B64_ENV} is not base64-encoded JSON.` }
  }
  if (typeof type !== 'string' || !type) {
    return {
      status: 'invalid',
      problem: `${CREDENTIALS_B64_ENV} decodes to JSON without a "type" (expected a service-account key or an authorized_user ADC file).`,
    }
  }

  // Named by content, so a changed value gets a new file and reruns are no-ops.
  const digest = createHash('sha256').update(json).digest('hex').slice(0, 12)
  const path = join(dir, `credentials-${digest}.json`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  writeFileSync(path, json, { mode: 0o600 })
  chmodSync(path, 0o600)
  env.GOOGLE_APPLICATION_CREDENTIALS = path
  return { status: 'written', path, type }
}

/** Run at process start: apply the variable and report a bad value on stderr. */
export function applyCredentialsFromEnv(): void {
  const result = credentialsFromEnv()
  if (result.status === 'invalid') process.stderr.write(`ga4-manager: ${result.problem} Ignoring it.\n`)
}

function defaultDir(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  return join(tmpdir(), `ga4-manager-${uid}`)
}

function isReadable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}
