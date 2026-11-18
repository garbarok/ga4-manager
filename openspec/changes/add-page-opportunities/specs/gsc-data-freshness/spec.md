# Spec Delta

## ADDED Requirements

### Requirement: data_through on Search Console performance results
Every tool that reads Search Console performance data SHALL return `data_through`: the latest `date` key of a final-data, date-dimension query over the last 14 days. Non-date keys SHALL be ignored. A failed lookup SHALL leave it empty or null and SHALL NOT fail the tool. The extra query SHALL be counted in `quota_used`.

#### Scenario: Diagnostic envelope
- **WHEN** `ga4 gsc decay --format json` runs
- **THEN** the envelope includes `data_through` and `quota_used` counts three queries (two windows + the date lookup)

### Requirement: Position and impression filters on analytics rows
`gsc_analytics_run` SHALL accept `min_position`, `max_position` and `min_impressions`. They SHALL be applied to the rows returned within `limit`, with aggregates recomputed over the kept rows. The result SHALL include `row_filter {bounds…, rows_considered, rows_kept, note}`, where the note says that only the fetched top rows were considered. `min_position > max_position` SHALL be a validation error.

#### Scenario: Striking-distance pages
- **WHEN** called with `dimensions: "page", min_position: 4, max_position: 20`
- **THEN** every returned row has 4 ≤ position ≤ 20 and `row_filter.rows_considered` is the number of rows fetched
