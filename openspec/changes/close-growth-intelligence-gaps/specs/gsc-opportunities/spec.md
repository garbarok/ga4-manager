# Spec Delta

## Purpose

Defines the opportunity diagnostic (see CONTEXT.md "Opportunity"): search results already on page 1–2 that convert fewer clicks than expected for their position. It works at query×page or at page granularity.

## ADDED Requirements

### Requirement: Query-granularity opportunities (existing behavior)
With `granularity: query` (the default), the diagnostic SHALL evaluate query×page rows against the predicate `position ∈ [5, 20] AND ctr < category_median_ctr`. The category is the rounded position bucket. The median comes from the site's own rows when the bucket has ≥2 rows, and from the published baseline curve otherwise. Results SHALL be sorted by `potential_clicks` descending. Output fields, filters (`days`, `min_impressions`, `min_potential_clicks`) and exit codes (0 none, 2 found, 1 failed) SHALL be unchanged from the current release.

#### Scenario: Default call is unchanged
- **WHEN** `gsc_opportunities` is called without `granularity`
- **THEN** the output is identical in shape and ordering to the current release

### Requirement: Page-granularity opportunities
With `granularity: page` (CLI `--granularity page`), the diagnostic SHALL evaluate page-level rows (GSC `page` dimension) against the same predicate, with these rules:
- Only pages with impressions ≥ `min_impressions` count as peers in a bucket's median.
- A bucket with fewer than 3 qualifying peer pages SHALL use the baseline curve.
- The baseline curve is a floor. The expected CTR SHALL be the higher of the bucket's site median and the baseline for that bucket, so a page is never excused because its neighbours also under-convert. `median_source` SHALL be `baseline` whenever the baseline value is used.
- Result rows SHALL leave `query` empty and include `top_queries`: up to 5 queries for that page with the most impressions, each with `query`, `impressions`, `clicks` and `position`.

#### Scenario: Large page hidden by query-level anonymization
- **WHEN** a page has 100,000 impressions at average position 8.8 with CTR 0.5%, and its bucket has fewer than 3 peer pages with ≥ `min_impressions`
- **THEN** the page is reported with `median_source: "baseline"`, `category_median_ctr` equal to the bucket-9 baseline, and `potential_clicks` ≈ impressions × (baseline − 0.005)

#### Scenario: Low-impression pages do not drag the median
- **WHEN** bucket 9 contains the target page, the homepage (2,000 impressions) and a legal page with 30 impressions, and `min_impressions` is 50
- **THEN** the legal page is excluded from the bucket's peers

#### Scenario: Under-converting neighbours do not hide a page
- **WHEN** a page with 50,000 impressions at CTR 1.5% shares bucket 6 with enough peer pages that the site median is 0% (for example, fragment URLs with no clicks)
- **THEN** the page is still reported, against the bucket-6 baseline, with `median_source: "baseline"`

#### Scenario: Site median above the baseline is kept
- **WHEN** a bucket has ≥3 peer pages and their median CTR is higher than the baseline for that bucket
- **THEN** that site median is the expected CTR and `median_source` is `site`

### Requirement: Anonymized-share signal in page mode
Each page-mode result SHALL include `anonymized_share`: the fraction of the page's impressions that do not appear in any query×page row for that page in the same window. It is computed as `1 − Σ(query rows impressions) / page impressions`, clamped to [0, 1]. This tells the consumer whether a title rewrite targets visible queries or a long tail GSC does not disclose.

#### Scenario: Long-tail-dominated page
- **WHEN** a page has 100,000 page-level impressions and its query×page rows sum to 15,000
- **THEN** its result reports `anonymized_share: 0.85`

### Requirement: Quota accounting per granularity
The JSON output SHALL report `quota_used`: 1 for query granularity, and 2 for page granularity (one page-level call plus one query×page call).

#### Scenario: Page mode quota
- **WHEN** the diagnostic runs with `granularity: page`
- **THEN** `quota_used` is 2
