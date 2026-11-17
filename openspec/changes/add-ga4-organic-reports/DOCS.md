# Docs to merge (for the central README / CHANGELOG pass)

## README tool table — new row

| GA4 organic reports | `ga4_organic_overview`, `ga4_organic_landing_pages`, `ga4_key_events`, `ga4_traffic_acquisition`, `ga4_audience`, `ga4_site_search`, `ga4_ecommerce`, `ga4_measurement_health` |

## mcp/README.md — short section

### GA4 organic reports
Organic Search = `sessionDefaultChannelGroup` "Organic Search". All take `property_id` or `config`, plus `days` (default 28, ending yesterday). They return an absolute `window`, and `warnings` that explain empty results.
- `ga4_organic_overview`: KPIs vs the previous equal window (`change`, `change_pct`), organic share of sessions, and a day/week trend.
- `ga4_organic_landing_pages`: landing-page outcomes (sessions, engagement, key events, key event rate, revenue); `order_by`, `limit`.
- `ga4_key_events`: key events by name (and landing page).
- `ga4_traffic_acquisition`: all channels by channel group and/or source/medium, with share.
- `ga4_audience`: country, device, or new vs returning.
- `ga4_site_search`: internal search terms.
- `ga4_ecommerce`: purchases, revenue and the item funnel.
- `ga4_measurement_health`: pass/warn/fail checks with `how_to_fix`: organic sessions, key events, consent, freshness, "(not set)", site search, time zone vs Search Console.

## CHANGELOG (root and mcp/) — Added

- GA4 organic reports (OpenSEO get_google_analytics_* parity), each also a `ga4m` command:
  - `ga4_organic_overview` (previous-period comparison and daily/weekly trend);
  - `ga4_organic_landing_pages`, `ga4_key_events`, `ga4_traffic_acquisition`, `ga4_audience`, `ga4_site_search`, `ga4_ecommerce`;
  - `ga4_measurement_health`, which checks whether the property records organic sessions, key events and consent, and explains every empty result, including a time-zone mismatch with Search Console.

## mcp/PERMISSIONS.md

The eight tools use `analytics.readonly` and Viewer on the property. `ga4_measurement_health` also reads property settings through the Analytics Admin API (analyticsadmin.googleapis.com, same scope).

## Note for item 2 (page_opportunities)

`utils/ga4-admin-client.ts` exports `getPropertySettings(propertyId)` (time_zone) and `GSC_TIME_ZONE`, for the "time zones differ" warning.
`ga4-organic-shared.ts` exports `ORGANIC_FILTER`, `resolvePropertyId` and `windows`.
