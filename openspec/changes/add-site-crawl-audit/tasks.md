# Tasks

## 1. Crawler
- [x] 1.1 `crawler.ts`: normalize URLs (tracking params, fragments), robots-style patterns, robots.txt + Crawl-delay, sitemap seeding (index files), manual redirects with loop detection, 429/503 backoff, budgets, rendering hook, BFS click depth, inlinks. Verify with `crawler.test.ts` on the fixture site.
- [x] 1.2 Content extraction: title, description, canonicals, robots meta, headings in order, images without alt, links, main-content words, sha1 + simhash. Verify that `<pre>` highlighting markup and nav/footer text are not counted.

## 2. Issues
- [x] 2.1 `site-issues.ts`: every issue type with severity and how_to_fix; summary and health score. Verify the fixture site yields each type exactly where expected, and that blocked and rate-limited URLs are never reported as broken.

## 3. Lighthouse
- [x] 3.1 `lighthouse.ts`: representative pages, PSI parse (scores, lab, field, savings), concurrency. Verify with a PSI fixture, including a non-array `details.items` audit (seen live).

## 4. Jobs and tools
- [x] 4.1 `audit-job.ts`: record, detached worker, stall detection, Lighthouse phase.
- [x] 4.2 The seven tools in `tools/site-audit.ts`. Verify with `site-audit.test.ts` (foreground run end to end, background launch + refusal of a second run, stalled worker, Lighthouse rerun, list and delete).

## 5. Live dry run
- [x] 5.1 Run `ga4m site-audit-run` in the background against a real site, poll status, and read issues and Lighthouse. Record the redacted result in `LIVE_RUN.md`. The run found and fixed three bugs: non-array PSI items, `<pre>` markup counted as words (false duplicate-content), and `text/plain` robots.txt not read.
