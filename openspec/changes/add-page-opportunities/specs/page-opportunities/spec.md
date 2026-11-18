# Spec Delta

## ADDED Requirements

### Requirement: Scored Search Console × GA4 page opportunities
`page_opportunities` SHALL read Search Console page rows and GA4 Organic Search landing pages for the same window: `days` ending at `data_through`, or three days ago when that is unknown. It SHALL consider pages with `min_position ≤ position ≤ max_position` and `impressions ≥ min_impressions`. It SHALL score each matched page as `round(100 × (0.5 demand + 0.3 business_value + 0.2 reachability))`, with each component in [0, 1] as defined in the proposal.

#### Scenario: Matched page
- **WHEN** a page at position 5 with the most impressions matches a GA4 landing page
- **THEN** its demand is 1, its reachability is (max_position − 5)/(max_position − min_position), and its score follows the formula

#### Scenario: Unmatched page
- **WHEN** a candidate page has no GA4 organic sessions
- **THEN** it is returned with `score: null`, `ga4: null` and an `unmatched_reason`, ordered after the scored pages

### Requirement: Engagement fallback and small-sample smoothing
When no matched page records key events, business value SHALL use engagement rate and the result SHALL say so in `business_value_basis` and a warning. Each page's rate SHALL be shrunk toward the session-weighted site average with a prior of 10 sessions before normalizing.

#### Scenario: One-session page
- **WHEN** a page has 1 session at a 100% rate and another has 300 sessions at 20%
- **THEN** the one-session page's smoothed rate is close to the site average instead of 5× the other

### Requirement: Coverage and warnings
The result SHALL include `coverage {gsc_pages_total, rows_considered, matched, unmatched, ga4_landing_pages}`. It SHALL warn when GA4 has no organic landing pages, when the GA4 property time zone differs from Search Console's Pacific Time (with the hour offset), when Search Console reports several hosts, when the GSC row limit was reached, and when nothing matched.

#### Scenario: Empty GA4
- **WHEN** GA4 returns no organic landing pages
- **THEN** every candidate is unmatched and warnings contain "GA4 has no organic landing pages"
