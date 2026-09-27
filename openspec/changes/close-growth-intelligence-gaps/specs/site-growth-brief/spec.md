# Spec Delta

## Purpose

Produces one compact, per-site growth brief that joins search, traffic and ad-revenue data with the top diagnostic findings. An AI assistant can draft an SEO and monetization plan from a single call instead of stitching together many tool outputs.

## ADDED Requirements

### Requirement: Brief per site from one or all configs
The `site_growth_brief` MCP tool SHALL accept either `config` (one YAML path) or `all: true`. With `all: true` it covers every config the server can discover, using the same discovery as `ga4_report --all`. It SHALL also accept `days` (default 28). For each site it SHALL return a brief with:
- `site`: project name, GSC site and GA4 property.
- `kpis`: GSC clicks, impressions, CTR and average position; GA4 sessions and engagement rate; ad revenue and revenue per 1k sessions.
- `deltas`: each KPI's percentage change versus the immediately preceding window of equal length.
- `top_pages`: up to 10 pages, with GSC clicks, GA4 sessions and ad revenue per page.
- `findings`: top diagnostic findings.
- `data_gaps`: sources that were skipped, and why.

#### Scenario: Single site
- **WHEN** called with `config: "configs/mysite.yaml"`
- **THEN** the result contains one brief with all sections populated from GSC, GA4 and AdSense-in-GA4

#### Scenario: All sites
- **WHEN** called with `all: true` and three configs are discoverable
- **THEN** the result contains three briefs, sorted by ad revenue descending, then GSC clicks descending

### Requirement: Page join across sources
`top_pages` SHALL join GSC page URLs to GA4 `pagePath` by comparing the URL path after normalization: fragment and query string dropped, trailing slash stripped, lowercased. Pages SHALL be ranked by ad revenue, then GSC clicks. A page present in only one source SHALL still appear, with the other source's fields set to null.

#### Scenario: Fragment variants collapse
- **WHEN** GSC reports `/blog/post` and `/blog/post#section` and GA4 reports `/blog/post`
- **THEN** a single `top_pages` entry for `/blog/post` sums the GSC metrics of both variants

### Requirement: Findings digest
`findings` SHALL contain at most 10 items drawn from the diagnostics: page-mode opportunities, CTR anomalies, URL-hygiene warnings, and hreflang warnings (hreflang only when `search_console.hreflang_pairs` is configured). Each item SHALL carry `source`, `summary`, `page` and an `impact` estimate in clicks per window where the diagnostic provides one. Items SHALL be ordered by impact descending, and items without impact come last. The brief SHALL NOT run URL Inspection.

#### Scenario: Largest opportunity first
- **WHEN** page-mode opportunities include a page with `potential_clicks` 5,000 and another with 12
- **THEN** the 5,000-click item is first in `findings`

### Requirement: Partial results instead of failure
If one source fails or is not configured for a site (no `ga4.property_id`, no `search_console.site_url`, missing scope, API error), the brief SHALL still return the other sections. It SHALL add an entry to `data_gaps` with the source name and error code, and SHALL set `success: true` with a warning. The tool SHALL return `success: false` only when every source fails for every site.

#### Scenario: AdSense not linked
- **WHEN** GA4 returns no ad impressions for the site
- **THEN** revenue KPIs are 0 and `data_gaps` includes `{ source: "ga4_ad_revenue", reason: "ad_revenue_unavailable" }`

#### Scenario: Config without GSC
- **WHEN** a config has no `search_console` section
- **THEN** GSC KPIs are null, and `data_gaps` includes `{ source: "gsc", reason: "not_configured" }`

### Requirement: Bounded size and cost
Each brief SHALL serialize to at most ~4 KB of JSON, so that `all: true` over several sites stays usable as assistant context. The result SHALL report total `quota_used` per API (`gsc`, `ga4_data`). The brief SHALL NOT call the AdSense Management API; revenue comes from GA4's AdSense-linked metrics.

#### Scenario: Quota is reported
- **WHEN** a brief is generated for one site with every source configured
- **THEN** `quota_used` lists per-API request counts
