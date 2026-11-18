# Proposal

## Why

OpenSEO answers "how is organic doing?" from GA4 with a set of get_google_analytics_* tools. GA4 Manager has `ga4_traffic_report`, which is a general breakdown report. It cannot filter to Organic Search, compare with the previous period, show key events, audience or site search, or explain why a report is empty. An agent that sees "0 organic sessions" cannot tell a site with no search traffic from a property whose referrers are stripped. Item 2 (page opportunities) also needs organic landing-page outcomes and the property time zone.

## What Changes

Eight new read-only native tools on the GA4 Data API. Each is also a `ga4m` command (ADR-0006).

- `ga4_organic_overview`: Organic Search totals compared with the equal window immediately before, organic share of all sessions, and a daily or weekly trend. Metrics: sessions, engaged sessions, engagement rate, key events, session key event rate, revenue, users, new users, average session duration.
- `ga4_organic_landing_pages`: per landing page (optionally with query string): sessions, engagement, key events, key event rate, revenue. Has `order_by` and `limit`, and flags a large "(not set)" share.
- `ga4_key_events`: key events by event name, optionally by landing page. Explains an empty result.
- `ga4_traffic_acquisition`: all channels by default channel group, source/medium, or both, with share of sessions.
- `ga4_audience`: by country, device or new vs returning; organic by default.
- `ga4_site_search`: search terms from `view_search_results`. Explains how to enable site search when it is empty.
- `ga4_ecommerce`: purchase totals and per-item funnel. Falls back to all channels when GA4 refuses the channel filter on item metrics, and says so.
- `ga4_measurement_health`: pass/warn/fail checks, each with `how_to_fix`:
  - sessions recorded;
  - organic sessions and share;
  - key events;
  - consent (custom events, or explicitly "cannot verify");
  - data freshness;
  - "(not set)" landing pages;
  - site search;
  - property time zone vs Search Console's Pacific Time.

Shared: `property_id | config` input, an absolute `window {start, end}` (N days ending yesterday), a `warnings` array that explains empty results, and the standard error contract. New `utils/ga4-admin-client.ts` reads property settings (time zone, currency) with `analytics.readonly`.

`ga4_traffic_report` is unchanged. It remains the free-form breakdown, including ad revenue.

## Capabilities

### New Capabilities
- `ga4-organic-reports`: organic-focused GA4 reporting and measurement health.

## Impact

- New files:
  - `mcp/src/tools/ga4-organic-shared.ts`;
  - `ga4-organic-reports.ts` and `ga4-measurement-health.ts`, each with a test;
  - `mcp/src/utils/ga4-admin-client.ts`.
- `registry.ts` gains 8 entries; `manifest.json` is synced. The tool names were already in the `ga4_data` group.
- Scopes: `analytics.readonly` only. No new dependencies.
