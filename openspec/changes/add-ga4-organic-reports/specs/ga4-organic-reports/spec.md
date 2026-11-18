# Spec Delta

## Purpose

Organic-search reporting from GA4 that an agent can trust: every report filters to Organic Search where that makes sense, states its exact window, and explains empty results instead of returning bare zeros.

## ADDED Requirements

### Requirement: Common input and output
Every tool SHALL accept `property_id` (numeric or `properties/N`) or `config` (its `ga4.property_id`), and `days` (1–365, default 28). The window SHALL be `days` days ending yesterday, returned as `window: {start, end}` in absolute dates. Every success SHALL carry `warnings: string[]`. Failures SHALL use `{success: false, error: {code, message, hint?}}`. All tools SHALL be read-only and request only `analytics.readonly`.

#### Scenario: Measurement ID supplied
- **WHEN** `property_id` is `G-ABC123`
- **THEN** the tool returns `INVALID_INPUT` without calling the API

#### Scenario: Neither property nor config
- **WHEN** neither `property_id` nor `config` is given
- **THEN** the tool returns `INVALID_INPUT`

### Requirement: Organic filter
"Organic" SHALL mean `sessionDefaultChannelGroup = "Organic Search"`. Landing pages, key events, audience and ecommerce SHALL default to `organic: true`. Site search SHALL default to `organic: false`. Acquisition SHALL always cover all channels.

#### Scenario: Organic report with no organic sessions
- **WHEN** an organic report returns no rows
- **THEN** `warnings` explains likely causes (tag not firing on landing pages, stripped referrers, overridden channel group) and points to `ga4_measurement_health`

### Requirement: Organic overview with previous period and trend
`ga4_organic_overview` SHALL return, for sessions, engaged_sessions, engagement_rate, key_events, session_key_event_rate, revenue, users, new_users and avg_session_duration_s, the values `{current, previous, change, change_pct}`. `previous` covers the equal window immediately before `window`. `change_pct` SHALL be null when previous is 0. The result SHALL also include `organic_share_of_sessions` and a `trend` of session metrics by day (`date`) or ISO week (`isoYearIsoWeek`, formatted `YYYY-Www`), selected by `granularity`.

#### Scenario: Weekly trend
- **WHEN** called with `granularity: "week"`
- **THEN** the trend request uses the `isoYearIsoWeek` dimension and periods read like `2026-W09`

#### Scenario: New property
- **WHEN** the previous window has no organic sessions
- **THEN** every `change_pct` is null and `warnings` says why

### Requirement: Breakdown reports
- `ga4_organic_landing_pages` SHALL return per landing page: sessions, engaged sessions, engagement rate, key events, session key event rate, revenue and average duration, plus totals. It is ordered by `order_by` (sessions, key_events, revenue, engagement_rate, key_event_rate) and capped by `limit`. It SHALL warn when "(not set)" exceeds 10% of sessions.
- `ga4_key_events` SHALL return event names with key events > 0 (optionally × landing page). When empty, it SHALL explain how to mark key events.
- `ga4_traffic_acquisition` SHALL break down by channel, source/medium, or both, with `share_of_sessions` per row.
- `ga4_audience` SHALL break down by country, device or new vs returning, with `share_of_sessions`.

#### Scenario: No key events
- **WHEN** no event has key events in the window
- **THEN** `rows` is empty and `warnings` says to mark events as key events in GA4 Admin

### Requirement: Site search and ecommerce explain absence
`ga4_site_search` SHALL report `searchTerm` values from `view_search_results` events, dropping "(not set)". When empty, it SHALL explain how to enable Enhanced measurement → Site search.

`ga4_ecommerce` SHALL report purchases, purchase revenue, average purchase revenue, total revenue, and per item views, add-to-carts, purchases and item revenue. When GA4 rejects the organic filter on item metrics, it SHALL retry without it, set `items_filtered_to_organic: false` and warn. When there are no purchases and no items, it SHALL explain that ecommerce events are not reaching GA4.

#### Scenario: Site search not enabled
- **WHEN** there are no `view_search_results` events with a term
- **THEN** `warnings` contains the enable-site-search explanation

#### Scenario: Item metrics cannot be filtered by channel
- **WHEN** the filtered item request fails with INVALID_INPUT
- **THEN** items are reported for all channels and `items_filtered_to_organic` is false

### Requirement: Measurement health
`ga4_measurement_health` SHALL return `checks[]` of `{check, status: pass|warn|fail, detail, how_to_fix}`:
- `sessions_recorded`;
- `organic_sessions`, when sessions exist;
- `key_events`;
- `consent`: a rate from `grant_event`/`deny_event` when given, else detection of consent-like events, else a warning that consent cannot be verified from the Data API;
- `data_freshness`: last day with sessions over the past 10 days;
- `organic_landing_pages`: "(not set)" share;
- `site_search`;
- `time_zone`: warn when not America/Los_Angeles, since Search Console dates are Pacific Time.

It SHALL also return `overall` (the worst status) and `property {display_name, time_zone, currency_code}`. A failed Admin API read SHALL degrade to a `time_zone` warning, not fail the tool.

#### Scenario: Property records other traffic but no organic
- **WHEN** sessions exist but none are Organic Search
- **THEN** `organic_sessions` is `fail` and `how_to_fix` names referrer policy, tracker redirects, custom channel groups and the Search Console link

#### Scenario: Non-Pacific property
- **WHEN** the property time zone is Europe/Madrid
- **THEN** `time_zone` is `warn` and says daily GA4 × GSC joins can be off by a day
