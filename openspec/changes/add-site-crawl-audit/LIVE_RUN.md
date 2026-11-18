# Live dry run (2026-11-18)

Target: a real, small production site (static, multilingual). The site name and URLs are intentionally left out. Run with `ga4m site-audit-run --start-url https://<site>/ --max-pages 300 --lighthouse --lighthouse-pages 3` (background), then polled with `ga4m site-audit-status` until done.

## Crawl

| Fact | Value |
|------|-------|
| Start redirect | apex → `www` (308), both hosts treated as internal |
| robots.txt | found, 1 sitemap listed |
| Sitemap URLs | 88 |
| Pages crawled | 151 (88 HTML content pages, 63 non-HTML: Markdown alternates, RSS, llms.txt, one zip) |
| Duration | 13 s, 0 HTTP 429 responses, page/time limit not reached |
| Status flow | queued → running → lighthouse → done |

## Issues found

| Severity | Type | Count |
|----------|------|-------|
| warning | thin-content | 4 (utility pages, 177+ main-content words) |
| warning | title-too-long | 3 (61 characters, well under the pixel limit) |
| notice | title-too-short | 10 |
| notice | description-too-short | 1 |

Health score 92. No orphans: every sitemap URL is linked.

## Lighthouse (3 pages × mobile + desktop)

All 6 runs succeeded. Average scores: mobile 100 / 99 / 100 / 100, desktop 98 / 99 / 100 / 100 (performance / accessibility / best practices / SEO). Lab LCP was 245–966 ms and CLS ≤ 0.001. There is no CrUX field data for this low-traffic site, so INP is reported as unavailable. Top savings were render-blocking resources and unused JavaScript.

## Bugs the live run found (fixed, with regression tests)

1. **PSI parsing.** Some audits return `details.items` as an object, not an array, so every Lighthouse run failed. Parsing now guards for it.
2. **Duplicate-content false positives.** Code blocks were kept as raw `<pre>` markup, so `span`/`class`/`style` tokens made every post with code look alike: 16 false hits. `<pre>` is now parsed normally, and text is scoped to `<main>`/`<article>`.
3. **robots.txt not read.** It is served as `text/plain`, which the fetcher skipped, so no sitemap was found. `text/plain` bodies are now read.

## Environment note

Node's `fetch` ignores `HTTPS_PROXY`. Behind a proxy, set `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) for the MCP server or `ga4m`. The detached worker inherits it.
