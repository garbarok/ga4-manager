# Live dry run (2026-11-18)

Real Search Console domain property and its GA4 property (one small personal site). The site name, URLs and absolute numbers that identify it are left out.

## page_opportunities (`--days 90 --min-impressions 20`)

| Fact | Value |
|------|-------|
| Window | 90 days ending at `data_through` (3 days before the run) |
| GSC pages in window | 144 |
| Rows considered (positions 4–20, ≥20 impressions) | 54 |
| Matched to GA4 organic landing pages | 31 |
| Unmatched (kept, unscored) | 23 |
| Business value basis | engagement rate (no key events on organic landing pages) |
| Quota | 2 GSC queries, 1 GA4 report |

All three expected warnings fired:
- Time zones differ: the property is on a UTC+1 zone, Search Console on Pacific Time, 9 h apart.
- Two GSC hosts: the main host and a links subdomain.
- No key events, so the engagement-rate fallback was used.

Top scores were 82–96, all for pages at positions 6–9 with the most impressions.

**Finding from this run, fixed:** before smoothing, pages with 1–2 GA4 sessions at a 100% engagement rate got the maximum business value. The scorer now shrinks each rate toward the site average with a 10-session prior. After that, the ranking follows demand and sample size.

## gsc_analytics_run filters

`--dimensions page --limit 1000 --min-position 4 --max-position 20 --min-impressions 20` gave `row_filter.rows_considered` 111 and `rows_kept` 52. Every kept row was inside [4, 20] with ≥20 impressions. `data_through` matched page_opportunities.

## data_through on a diagnostic

`ga4 gsc decay --format json` returned `data_through` and `quota_used: 3` (two windows + the date lookup).
