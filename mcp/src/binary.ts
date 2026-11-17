import { fileURLToPath } from 'url'
import { dirname, join, delimiter } from 'path'
import { accessSync, constants, readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the ga4 CLI binary, in priority order:
 *   1. GA4_BINARY_PATH — explicit override (used verbatim, even if missing,
 *      so an intentional misconfiguration still surfaces a clear error).
 *   2. The repo-root build next to mcp/ (../../ga4) — the dev default.
 *   3. A `ga4` on the user's PATH (e.g. a globally installed binary).
 * If nothing is found, return the repo-root default so CLIExecutor emits the
 * helpful "build it first" hint.
 */
export function resolveBinaryPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GA4_BINARY_PATH) return env.GA4_BINARY_PATH

  const repoRootBinary = join(__dirname, '../../ga4')
  if (isExecutable(repoRootBinary)) return repoRootBinary

  const onPath = findOnPath('ga4', env.PATH)
  if (onPath) return onPath

  return repoRootBinary
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOnPath(name: string, pathEnv: string | undefined): string | null {
  if (!pathEnv) return null
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/** Single source of truth for the server version: package.json (dist/ -> ../package.json). */
export function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
