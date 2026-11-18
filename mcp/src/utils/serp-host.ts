/**
 * Real host and URL of a Google search result.
 *
 * Google now often serves organic results through a redirect,
 * `https://google.com/goto?url=CAES…`. The token is opaque, so the result's
 * own host is only in the side fields the SERP APIs return:
 *   - DataForSEO: `breadcrumb` ("https://www.example.com › blog › post…") and
 *     `website_name`; `domain` is "google.com".
 *   - ValueSERP: `domain` (correct) and `displayed_link`.
 * Matching a site against the wrapped URL makes a ranking page look absent,
 * so every tool that reads SERPs goes through these helpers.
 */

export interface SerpResultFields {
  url?: string | null
  domain?: string | null
  /** DataForSEO breadcrumb or ValueSERP displayed_link: "https://host › seg › seg". */
  breadcrumb?: string | null
  displayed_link?: string | null
  website_name?: string | null
}

const GOOGLE_HOSTS = new Set(['google.com', 'www.google.com'])

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** True for Google's redirect wrapper (any google.* host with /goto or /url?). */
export function isWrappedUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const host = hostOf(url)
  if (!host) return false
  return /(^|\.)google\.[a-z.]+$/.test(host) && /\/(goto|url)\?/.test(url)
}

function crumbHost(crumb: string | null | undefined): string | null {
  if (!crumb) return null
  const first = crumb.split('›')[0]?.trim()
  return hostOf(first) ?? hostOf(`https://${first}`)
}

function looksLikeDomain(s: string | null | undefined): s is string {
  return Boolean(s && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim()))
}

/**
 * The result's own host, lowercase, or null when nothing identifies it.
 * Never returns google.com for a wrapped result.
 */
export function resultHost(r: SerpResultFields): string | null {
  if (r.url && !isWrappedUrl(r.url)) {
    const h = hostOf(r.url)
    if (h) return h
  }
  const fromCrumb = crumbHost(r.breadcrumb) ?? crumbHost(r.displayed_link)
  if (fromCrumb) return fromCrumb
  const domain = r.domain?.trim().toLowerCase()
  if (domain && !GOOGLE_HOSTS.has(domain) && looksLikeDomain(domain)) return domain
  if (looksLikeDomain(r.website_name)) return r.website_name.trim().toLowerCase()
  return null
}

export interface ResultUrl {
  /** The page URL when known exactly; null for a wrapped result. */
  url: string | null
  /** Google's redirect link, when the result was wrapped. */
  url_wrapped: string | null
  /**
   * Best reconstruction of a wrapped result's page URL from its breadcrumb.
   * Approximate: Google truncates long paths ("…") and shows labels, not
   * always slugs. Null when there is no breadcrumb.
   */
  url_hint: string | null
}

export function resultUrl(r: SerpResultFields): ResultUrl {
  if (!r.url || !isWrappedUrl(r.url)) return { url: r.url ?? null, url_wrapped: null, url_hint: null }
  const crumb = r.breadcrumb ?? r.displayed_link
  let hint: string | null = null
  if (crumb) {
    const [origin, ...segs] = crumb.split('›').map((s) => s.trim()).filter(Boolean)
    const base = hostOf(origin) ? origin.replace(/\/+$/, '') : null
    if (base) {
      const clean = segs.map((s) => s.replace(/(\.\.\.|…)$/, '')).filter(Boolean)
      hint = clean.length ? `${base}/${clean.join('/')}` : `${base}/`
    }
  }
  return { url: null, url_wrapped: r.url, url_hint: hint }
}

/** www.-insensitive; subdomains of the site count. */
export function hostMatchesSite(host: string | null, site: string): boolean {
  if (!host) return false
  const h = host.toLowerCase().replace(/^www\./, '')
  const s = site.toLowerCase().replace(/^www\./, '')
  return h === s || h.endsWith(`.${s}`)
}

/** Host of an AI-answer reference ({domain, url, source, title}); null when unidentifiable. */
export function referenceHost(r: { domain?: string | null; url?: string | null; source?: string | null; title?: string | null }): string | null {
  const h = resultHost({ url: r.url, domain: r.domain, website_name: r.source })
  if (h) return h
  return looksLikeDomain(r.source) ? r.source.toLowerCase() : null
}
