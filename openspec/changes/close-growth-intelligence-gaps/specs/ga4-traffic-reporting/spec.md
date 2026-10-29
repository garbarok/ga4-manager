# Spec Delta

## Purpose

Exposes GA4 Data API traffic, engagement and ad-revenue reporting so an assistant can see which pages and channels bring visits and money, not just search impressions.

## ADDED Requirements

### Requirement: Traffic report by a chosen breakdown
The `ga4_traffic_report` MCP tool SHALL accept either a `property_id` (numeric or `properties/N`) or a `config` path whose `ga4.property_id` is used. It SHALL also accept:
- a `days` window (1–365, default 28), ending yesterday;
- up to two `dimensions` from `pagePath`, `landingPage`, `sessionDefaultChannelGroup`, `sessionSource`, `country`, `deviceCategory` and `date` (default `["pagePath"]`);
- a `limit` (1–1000, default 50).

For each row it SHALL return `sessions`, `engaged_sessions`, `engagement_rate`, `average_session_duration_s` and `page_views`. The result SHALL also carry a `totals` object over the same metrics.

#### Scenario: Default page report
- **WHEN** the tool is called with only `property_id: "123456789"`
- **THEN** it returns up to 50 `pagePath` rows for the last 28 days, each with the five traffic metrics, plus totals

#### Scenario: Measurement ID supplied
- **WHEN** `property_id` is `"G-ABC123"`
- **THEN** the tool returns `INVALID_INPUT` explaining that a Property ID is required

#### Scenario: Neither property nor config supplied
- **WHEN** neither `property_id` nor `config` is given
- **THEN** the tool returns `INVALID_INPUT`

### Requirement: Ad revenue columns when AdSense is linked
Each row and the totals SHALL include `ad_revenue`, `ad_impressions`, `ad_clicks` and a derived `revenue_per_1k_sessions`, computed as `ad_revenue / sessions × 1000` and rounded to 2 decimals (0 when sessions is 0). If total ad impressions over the window are 0, the result SHALL include the warning `ad_revenue_unavailable`, which says the AdSense↔GA4 link may be missing. The revenue columns SHALL still be present with value 0.

#### Scenario: Linked property
- **WHEN** the property has AdSense linked and served ads in the window
- **THEN** rows carry non-zero `ad_revenue` and `revenue_per_1k_sessions`, and no `ad_revenue_unavailable` warning is present

#### Scenario: Unlinked property
- **WHEN** the property has no AdSense data in the window
- **THEN** all revenue columns are 0 and `warnings` contains `ad_revenue_unavailable`

### Requirement: Rows ordered by a selectable metric
The tool SHALL accept `order_by` from `sessions`, `page_views`, `ad_revenue` and `engagement_rate` (default `sessions`). Rows SHALL be returned in descending order of that metric before `limit` is applied.

#### Scenario: Pages ranked by revenue
- **WHEN** the tool is called with `order_by: "ad_revenue"`
- **THEN** the first row is the page with the highest ad revenue in the window

### Requirement: Read-only and standard error contract
The tool SHALL request only the `analytics.readonly` scope. It SHALL report failures with the shared `{ success: false, error: { code, message, hint? } }` shape:
- 403 maps to `AUTH_DENIED`.
- 404 maps to `NOT_FOUND`.
- 429 maps to `QUOTA_EXCEEDED`.
- Any other 4xx maps to `INVALID_INPUT`.
- 5xx maps to `UPSTREAM_5XX`.

#### Scenario: No access to property
- **WHEN** the credential lacks Viewer on the property
- **THEN** the tool returns `AUTH_DENIED` with a hint pointing to `mcp/PERMISSIONS.md`
