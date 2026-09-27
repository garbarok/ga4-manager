# Spec Delta

## Purpose

Detects URLs that receive Google search impressions but should never be indexed as standalone results. These are usually framework artifacts, fragments or broken links that dilute a site's index and hint at a bug.

## ADDED Requirements

### Requirement: Classify impression-bearing URLs into hygiene issue types
`ga4 gsc url-hygiene --config <file>` and the `gsc_url_hygiene` MCP tool SHALL fetch page-level Search Analytics rows for the window (`days`, default 90). Each URL SHALL be classified into at most one issue type, checked in this precedence order:
1. `malformed_path`: the path contains the site's own host name as a segment (e.g. `/www.example.com/...`), or contains `//`.
2. `fragment`: the URL contains `#`.
3. `asset_route`: the path matches a framework asset route: any segment equal to `opengraph-image`, `twitter-image`, `icon` or `apple-icon`, or a path beginning with `/_next/`.
4. `query_duplicate`: the URL has a query string, and the same URL without the query string also appears in the rows.
5. `utility_page`: the last path segment is one of `privacy`, `terms`, `cookies`, `disclaimer`, `legal` or `contact`.

`utility_page` findings SHALL be severity `info`. All others SHALL be severity `warning`. URLs matching no rule SHALL NOT appear in the output.

#### Scenario: Repeated host segment
- **WHEN** GSC reports impressions for `https://www.example.com/www.example.com/calculator/x`
- **THEN** it is reported as `malformed_path` with severity `warning`

#### Scenario: OG image route
- **WHEN** GSC reports impressions for `https://www.example.com/calculator/x/opengraph-image?abc`
- **THEN** it is reported as `asset_route`, not `query_duplicate`

#### Scenario: Section anchor
- **WHEN** GSC reports impressions for `https://www.example.com/blog/post#section`
- **THEN** it is reported as `fragment`

#### Scenario: Clean site
- **WHEN** no URL matches any rule
- **THEN** `results` is empty and the CLI exits 0

### Requirement: Actionable output
Each result SHALL carry `url`, `issue`, `severity`, `impressions`, `clicks` and a one-line `fix` recommendation specific to the issue type. Examples: for `asset_route`, disallow or `noindex` the asset route; for `malformed_path`, find the relative link missing a leading slash or scheme. Results SHALL be sorted by severity (warning first), then impressions descending. The JSON output SHALL include `quota_used: 1`. The CLI SHALL exit 2 when any `warning` finding exists, 0 when only `info` findings or none exist, and 1 on failure.

#### Scenario: Only utility pages found
- **WHEN** the only findings are `utility_page`
- **THEN** results are returned and the CLI exits 0
