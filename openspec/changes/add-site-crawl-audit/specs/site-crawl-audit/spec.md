# Spec Delta

## ADDED Requirements

### Requirement: Same-origin, robots-aware crawl with budgets
`site_audit_run` SHALL crawl from `start_url` over links on the start host (and the host its start redirect lands on), plus sitemap URLs, until `max_pages` pages or `max_duration_s` seconds. URLs disallowed for the audit user agent SHALL NOT be fetched and SHALL be recorded as `blocked_robots`. URLs matching an `exclude_paths` robots-style pattern SHALL NOT be fetched or counted.

#### Scenario: Blocked path
- **WHEN** robots.txt disallows `/private/` and the home page links to `/private/x`
- **THEN** `/private/x` is never requested, is recorded `blocked_robots`, and is not reported as broken

#### Scenario: Page budget reached
- **WHEN** more internal URLs are discovered than `max_pages`
- **THEN** the crawl stops at `max_pages` and the issues include a `crawl-page-limit` notice with the number of unvisited URLs

### Requirement: Backoff on rate limiting
On HTTP 429, or 503 with Retry-After, the crawler SHALL wait (Retry-After if given, else exponential, capped at 60 s), drop to one worker with at least 1 s between requests, and retry up to 3 times. A URL still throttled SHALL be recorded `rate_limited` and reported only under the `rate-limited` notice, never as a broken link.

#### Scenario: Throttled URL
- **WHEN** a URL answers 429 on every attempt
- **THEN** its status_kind is `rate_limited` and `broken-internal-link` does not list it

### Requirement: Site-wide issues with severity and fix
When the crawl ends, the audit SHALL compute every issue type listed in the proposal. Each issue SHALL have `{type, severity, title, how_to_fix, count, pages[{url, detail}]}`, with issues sorted error, then warning, then notice.

#### Scenario: Orphan page
- **WHEN** a sitemap URL returns 200 and no crawled page links to it (directly or via a redirect)
- **THEN** it is reported as `orphan-page`

### Requirement: Background run with status polling and persistence
By default `site_audit_run` SHALL return an `audit_id` immediately with status `queued`, and the crawl SHALL continue in a detached process. `site_audit_status` SHALL report status, progress and ETA, and SHALL report `stalled` when the worker has died. Audits SHALL persist per site; reads default to the newest. A second run for a site with a running audit SHALL be refused.

#### Scenario: Poll until done
- **WHEN** an agent polls `site_audit_status` after starting an audit
- **THEN** status moves queued → running → (lighthouse →) done, and `site_audit_issues` returns `INVALID_INPUT` until it is done

### Requirement: Lighthouse on representative pages
With `lighthouse: true`, or later via `site_audit_lighthouse {run: true}`, the audit SHALL run PageSpeed Insights for up to 10 representative pages and each requested strategy. Per run it SHALL store category scores; lab LCP, CLS, TBT, TTFB and FCP; field LCP, CLS, INP and TTFB with their source (url or origin); and the top 5 savings with resources.

#### Scenario: No field data
- **WHEN** CrUX has no data for the page or its origin
- **THEN** `field.source` is null and the result notes that INP exists only as field data
