# Tasks

## 1. data_through
- [x] 1.1 Go `gsc.DataThrough` (date dimension, last 14 days, final data, ignores non-date keys). Verify with `datathrough_test.go`.
- [x] 1.2 `diagcmd.Envelope.DataThrough` + `AttachDataThrough`, called after each diagnostic's own queries; hreflang's JSON struct gains the field; health attaches when its client serves Search Analytics. Verify with `go test ./...`; quota expectations updated for the extra unit.
- [x] 1.3 TS `gscDataThrough`; `gsc_traffic_compare` returns `data_through`. Verify with its test suite (the lookup is issued after the period queries).

## 2. gsc_analytics_run filters
- [x] 2.1 Go `gsc.RowFilter` with Apply/aggregates and `--min-position/--max-position/--min-impressions`. Verify with `rowfilter_test.go`.
- [x] 2.2 TS inputs, args and parsing of `row_filter` / `data_through`. Verify with `gsc-analytics.test.ts`.

## 3. page_opportunities
- [x] 3.1 Pure `compute-page-opportunities.ts` (path join, components, smoothing, coverage, warnings). Verify with tests for matched/unmatched, engagement fallback, smoothing, empty GA4 and multiple hosts.
- [x] 3.2 Tool with shared window, GA4 organic filter, time-zone warning. Verify with a fetch-mocked test that both sources read the same window.

## 4. Live dry run
- [x] 4.1 `ga4m page-opportunities --config <live> --days 90`, `ga4m gsc-analytics-run` with filters and `ga4m gsc-decay`. Results in `LIVE_RUN.md`, with no site data.
