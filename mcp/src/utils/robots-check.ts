import { createRequire } from 'module'
import { TTLCache } from './cache.js'

const require = createRequire(import.meta.url)
// robots-parser is CJS-only; its d.ts ambient declaration conflicts with esModuleInterop
const robotsParser = require('robots-parser') as (
  url: string,
  content: string,
) => { isAllowed(url: string, ua?: string): boolean | undefined }

const ONE_HOUR_MS = 60 * 60 * 1000

// Singleton cache: one robots.txt per origin, 1-hour TTL
// Using `null` as sentinel for "fetch failed / no robots.txt" (= allow all)
const cache = new TTLCache<string | null>(ONE_HOUR_MS)

export async function isAllowed(url: string, userAgent: string): Promise<boolean> {
  const origin = new URL(url).origin
  let robotsTxt = cache.get(origin)

  if (robotsTxt === undefined) {
    // Not cached yet — fetch
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': userAgent },
      })
      // 404 or any non-2xx: treat as allowed
      robotsTxt = res.ok ? await res.text() : null
    } catch {
      // Network error / timeout: treat as allowed
      robotsTxt = null
    }
    cache.set(origin, robotsTxt)
  }

  // null means no robots.txt or unreachable — allow
  if (robotsTxt === null) return true

  const robots = robotsParser(`${origin}/robots.txt`, robotsTxt)
  const result = robots.isAllowed(url, userAgent)
  // isAllowed returns undefined when no rules match — treat as allowed
  return result !== false
}
