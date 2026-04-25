// ============================================================================
// html-signals.ts — pure HTML signal extraction, no I/O
// ============================================================================

export interface HtmlSignals {
  title: string | null
  title_length: number
  description: string | null
  description_length: number
  canonical: string | null
  robots: string | null
  noindex: boolean
  og: {
    title: string | null
    description: string | null
    image: string | null
    type: string | null
  }
  schema_types: string[]
  h1_count: number
  h2_count: number
  hreflang_count: number
}

function countMatches(html: string, pattern: RegExp): number {
  const matches = html.match(new RegExp(pattern.source, 'gi'))
  return matches ? matches.length : 0
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  return match[1].replace(/\s+/g, ' ').trim() || null
}

export function extractMetaContent(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`,
    'i',
  )
  const match = html.match(pattern)
  if (!match) return null
  return (match[1] ?? match[2] ?? null)?.trim() || null
}

export function extractCanonical(html: string, baseUrl?: string): string | null {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
  )
  if (!match) return null
  const raw = (match[1] ?? match[2] ?? null)?.trim()
  if (!raw) return null
  if (!baseUrl) return raw
  try {
    return new URL(raw, baseUrl).href
  } catch {
    return raw
  }
}

export function countHreflang(html: string): number {
  return countMatches(html, /<link[^>]+hreflang=/i)
}

export function extractSchemaTypes(html: string): string[] {
  const types: string[] = []
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown> | unknown[]
      const extractType = (obj: unknown): void => {
        if (Array.isArray(obj)) {
          obj.forEach(extractType)
        } else if (obj && typeof obj === 'object') {
          const record = obj as Record<string, unknown>
          if (record['@type']) {
            const t = record['@type']
            if (Array.isArray(t)) types.push(...(t as string[]))
            else if (typeof t === 'string') types.push(t)
          }
          if (Array.isArray(record['@graph'])) record['@graph'].forEach(extractType)
        }
      }
      extractType(parsed)
    } catch {
      // Invalid JSON-LD — skip
    }
  }

  return [...new Set(types)]
}

export function extractSignals(html: string, baseUrl: string): HtmlSignals {
  const title = extractTitle(html)
  const description = extractMetaContent(html, 'description')
  const canonical = extractCanonical(html, baseUrl)
  const robots = extractMetaContent(html, 'robots')

  const og = {
    title: extractMetaContent(html, 'og:title'),
    description: extractMetaContent(html, 'og:description'),
    image: extractMetaContent(html, 'og:image'),
    type: extractMetaContent(html, 'og:type'),
  }

  const schema_types = extractSchemaTypes(html)
  const h1_count = countMatches(html, /<h1[\s>]/i)
  const h2_count = countMatches(html, /<h2[\s>]/i)
  const hreflang_count = countHreflang(html)
  const noindex = robots ? /noindex/i.test(robots) : false

  return {
    title,
    title_length: title ? title.length : 0,
    description,
    description_length: description ? description.length : 0,
    canonical,
    robots,
    noindex,
    og,
    schema_types,
    h1_count,
    h2_count,
    hreflang_count,
  }
}
