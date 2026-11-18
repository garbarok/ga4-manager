# Tasks

## 1. Shared plumbing
- [x] 1.1 `ga4-organic-shared.ts`: property resolution (id or config), absolute windows (current + previous), organic filter, AND-combinator, row/total mapping, error guard. Verify with unit tests for windows, pctDelta and andFilters.
- [x] 1.2 `utils/ga4-admin-client.ts`: `getPropertySettings` (time zone, currency) via Admin API v1beta with analytics.readonly.

## 2. Reports
- [x] 2.1 `ga4_organic_overview` (4 requests: current, previous, all-sessions denominator, trend). Verify with fixture tests for comparison, share, daily/weekly trend, empty warning, config resolution and error mapping.
- [x] 2.2 `ga4_organic_landing_pages`, `ga4_key_events`, `ga4_traffic_acquisition`, `ga4_audience`. Verify with fixture tests for request bodies (dimensions, filters, orderBys), mapping, shares and empty/"(not set)" warnings.
- [x] 2.3 `ga4_site_search` and `ga4_ecommerce`, including the item-filter fallback. Verify with fixture tests.
- [x] 2.4 `ga4_measurement_health` with a pure `evaluateHealth`. Verify with tests for a healthy property, every failure explanation, the consent rate from custom events, and an Admin read failure degrading to a warning.

## 3. Wiring
- [x] 3.1 Register in `registry.ts` after `ga4_traffic_report`; run `manifest:sync`. Verify registry, server-info group and CLI parity tests.
- [x] 3.2 Live read-only run of all eight tools with `ga4m <tool> --config <live config>`: every tool succeeds against a real property. The weekly trend and channel × source/medium breakdown work. Ecommerce keeps the organic filter on item metrics, and the health check returns all eight checks. No site data was committed.
