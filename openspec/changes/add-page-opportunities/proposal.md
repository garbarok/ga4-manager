# Proposal

## Why

OpenSEO's get_search_opportunities ranks pages by search demand and business outcome together. GA4 Manager has `gsc_opportunities`, which looks at CTR against peers, and `site_growth_brief`, which reports revenue. Neither answers "which striking-distance page is worth improving first, given what its visitors do?".

Separately, every GSC result is read without knowing how fresh the data is, so a two-day lag looks like a traffic drop. And `gsc_analytics_run` cannot restrict rows to a position band, which is the first step of every striking-distance analysis.

## What Changes

- **New `page_opportunities` tool** (CLI: `ga4m page-opportunities`).
  - Joins Search Console pages in a position band (default 4–20, `min_impressions` 50) with GA4 Organic Search landing-page outcomes, over the same calendar window ending at `data_through`.
  - Join key: the lowercased, decoded path without query string or trailing slash.
  - Score: `round(100 × (0.5 demand + 0.3 business_value + 0.2 reachability))`.
    - demand: log-scaled impressions relative to the largest candidate.
    - business_value: session key-event rate (engagement rate when the property records no key events), shrunk toward the site average with a 10-session prior, relative to the best matched page.
    - reachability: 1 at the top of the band, 0 at the bottom.
  - Unmatched pages stay visible with `score: null` and a reason.
  - Returns `coverage` {gsc_pages_total, rows_considered, matched, unmatched, ga4_landing_pages}, `potential_clicks` at position-3 CTR, the formula, and the window.
  - Warnings:
    - GA4 has no organic landing pages;
    - no key events (engagement-rate fallback);
    - time zones differ, with the hour offset;
    - several GSC hosts share GA4 paths;
    - the GSC row limit was hit;
    - nothing matched.
- **`gsc_analytics_run` filters.** `min_position`, `max_position` and `min_impressions` (CLI `--min-position`, `--max-position`, `--min-impressions`) are applied over the fetched top rows, since GSC cannot filter by position. Aggregates are recomputed over the kept rows. `row_filter` reports rows considered vs kept, with a note.
- **`data_through` on every Search Console performance tool.** This is the last date with final data, from one date-dimension query, and is never fatal. It covers:
  - `gsc_analytics_run`, `gsc_decay`, `gsc_ctr_anomaly`, `gsc_cannibalization`, `gsc_opportunities`, `gsc_url_hygiene` and `gsc_hreflang`, via Go `gsc.DataThrough` / `diagcmd.AttachDataThrough`;
  - `gsc_traffic_compare`, `page_opportunities` and `gsc_change_impact`, via TS `gscDataThrough`;
  - `gsc_health`, when its client also serves Search Analytics.

  Tools with no performance data (sitemaps, URL inspection, coverage, monitor) have nothing to date and are unchanged.

## Capabilities

### New Capabilities
- `page-opportunities`
- `gsc-data-freshness` (data_through and position filters)

## Impact

- Go: `internal/gsc/datathrough.go`, `internal/gsc/rowfilter.go`, `diagcmd.Envelope.DataThrough`, `cmd/gsc_analytics.go` flags, and a one-line attach in each diagnostic.
- **Behaviour change:** each diagnostic now uses one more GSC quota unit (the date query); the tests now pin the new counts.
- TS: `tools/page-opportunities.ts`, `tools/compute-page-opportunities.ts`, `utils/gsc-data-through.ts`, plus the `gsc-analytics.ts` inputs/outputs.
