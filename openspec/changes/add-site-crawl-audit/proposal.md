# Proposal

## Why

OpenSEO's site audit (run_site_audit, get_audit_status/issues/pages/lighthouse, list, delete) crawls a whole site and reports site-wide problems. GA4 Manager's `seo_audit_batch` only checks a URL list that the caller already has. That means it cannot find orphan pages, click depth, duplicate content, redirect chains, or broken internal links that no list mentions.

## What Changes

New tools: `site_audit_run`, `site_audit_status`, `site_audit_issues`, `site_audit_pages`, `site_audit_lighthouse`, `site_audit_list`, `site_audit_delete`. Each is also a `ga4m` command.

- **Crawler** (`mcp/src/audit/crawler.ts`):
  - Same-origin from a start URL. The start redirect's host (http→https, apex→www) also counts as internal.
  - Seeded from the sitemaps listed in robots.txt, or `/sitemap.xml`.
  - Page budget (`max_pages`) and time budget (`max_duration_s`).
  - `exclude_paths` takes robots-style patterns (`*`, trailing `$`).
  - Respects robots.txt and its Crawl-delay. Blocked URLs are recorded as `blocked_robots` and never fetched.
  - HTTP 429 (and 503 with Retry-After) triggers backoff that honours Retry-After, drops the crawl to one worker and at least 1 s between requests. URLs still throttled after retries are `rate_limited`, not broken.
  - Redirects are followed by hand, so chains and loops are recorded.
  - Optional JS rendering (Cloudflare Browser Rendering), falling back to raw HTML.
  - Content text is scoped to `<main>` / a single `<article>`.
  - After the crawl, exact click depth is computed by BFS over the link graph, with redirects resolved.
- **Issues** (`mcp/src/audit/site-issues.ts`, pure). Each issue has a severity and a concrete `how_to_fix`:
  - broken-internal-link (direct or via a redirect), unreachable-page, orphan-page, no-outgoing-links, deep-page;
  - redirect-chain, redirect-loop, internal-link-to-redirect;
  - duplicate-title, duplicate-meta-description, duplicate-content (exact hash + 64-bit simhash), thin-content;
  - heading-order-skip, missing-h1, multiple-h1, images-missing-alt, slow-response;
  - canonical-conflict, canonicalized-page, noindex-page;
  - missing-title, title-too-long, title-too-short, missing-description, description-too-long, description-too-short;
  - blocked-by-robots and rate-limited notices, and the crawl-page-limit and crawl-time-limit notices.
- **Lighthouse** (`mcp/src/audit/lighthouse.ts`), via PageSpeed Insights:
  - Up to 10 representative pages (the start URL plus the most-linked page per section), mobile and desktop.
  - Category scores; lab LCP, CLS, TBT, TTFB and FCP; field LCP, CLS, INP and TTFB from CrUX.
  - Per page, the top 5 savings with their resources.
- **Background jobs** (`mcp/src/audit/audit-job.ts`):
  - `site_audit_run` writes a queued record and starts a detached `ga4m __site-audit-worker` process. That process is the record's only writer while it runs.
  - Status reports ETA and detects a dead worker (`stalled`).
  - Results are persisted per audit under `site-audits/<site>/<id>.json` and `site-audit-pages/<site>/<id>.json`.
  - Reads default to the newest audit. Delete stops a running worker. One running audit per site.
  - `background: false` runs in the foreground, for cron.

## Capabilities

### New Capabilities
- `site-crawl-audit`

## Impact

New `mcp/src/audit/` module and `mcp/src/tools/site-audit.ts`, plus a hidden worker command in `mcp/src/cli.ts`. No new dependencies: it uses `node-html-parser` and `robots-parser`, which are already present. No paid DataForSEO calls. Cloudflare rendering is opt-in and counts against the session cap.
