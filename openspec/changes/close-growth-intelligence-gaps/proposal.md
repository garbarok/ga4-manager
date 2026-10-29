# Proposal

## Why

A live diagnostic run of the MCP server against a real Operator site (90 days, GSC + AdSense; site details intentionally omitted) exposed seven gaps. Because of them, an AI assistant cannot turn the tool's output into a growth or monetization plan:

- Two AdSense bugs make revenue reporting unreliable.
- The GA4 Data API is not exposed for traffic or revenue.
- The opportunity detector misses the single largest opportunity on a site (a page with six-figure impressions converting well below 1% on page 1), because it only works per query and that page's impressions sit in GSC's anonymized long tail.
- There is no URL-hygiene check, no multi-site rollup, and no hreflang check.

The data needed to fix all of this is already reachable with the scopes the tool holds today. Live probing confirmed that `totalAdRevenue` × `pagePath` is populated in GA4 when AdSense is linked.

## What Changes

- **Fix `adsense_report` date presets.** Remove `LAST_MONTH`, `LAST_3_MONTHS`, `LAST_6_MONTHS`, `LAST_12_MONTHS` and `LAST_YEAR`: the AdSense v2 API rejects each with HTTP 400 (verified live). Callers who need those windows use `CUSTOM`. **BREAKING** (input enum narrows; those values never worked).
- **Fix AdSense error classification.** HTTP 4xx responses other than 401/403/404/429 map to `INVALID_INPUT` with the upstream message. Only 5xx maps to `UPSTREAM_5XX`.
- **Add ordering to `adsense_report`.** A new `order_by` input (e.g. `["-ESTIMATED_EARNINGS"]`) is passed through to the API, so `limit` returns the top N rows instead of the first N alphabetically.
- **New `ga4_traffic_report` tool.** A GA4 Data API report by page, landing page, channel, source, country or date. It returns sessions, engagement, page views and, when AdSense is linked, ad revenue, with derived revenue per 1,000 sessions.
- **Page-level mode for `gsc_opportunities`.** A new `granularity: query | page` input (CLI `--granularity`). Page mode applies a minimum-impression floor to peers and falls back to the baseline CTR curve when a bucket has too few qualifying peer pages. Each result reports how much of the page's impressions are in GSC's anonymized long tail.
- **New `gsc_url_hygiene` diagnostic (CLI + MCP).** Flags URLs receiving search impressions that should never be in the index: fragment URLs, framework asset routes (`/opengraph-image`, `/twitter-image`, `/_next/`), query-string duplicates, malformed paths with a repeated host segment, and legal/utility pages.
- **New `gsc_hreflang` diagnostic (CLI + MCP)** (implements backlog BO-07). Finds translation pairs, checks reciprocal hreflang annotations on both sides, and flags queries whose language does not match the ranking page's locale.
- **New `site_growth_brief` tool.** For each config (or all configs), it joins GSC with GA4 traffic and AdSense-in-GA4 revenue into one compact per-site brief: KPIs, period-over-period deltas, top pages by revenue and by clicks, and the top findings from the diagnostics above. This is the context an assistant needs to write a plan.

## Capabilities

### New Capabilities
- `adsense-reporting`: The `adsense_report` contract: valid date ranges, ordering, and error classification.
- `ga4-traffic-reporting`: The GA4 Data API traffic and revenue report, with revenue-per-session metrics.
- `gsc-opportunities`: The opportunity diagnostic, including the new page-level granularity and its peer/baseline rules.
- `gsc-url-hygiene`: Detecting index-polluting URLs that receive search impressions.
- `gsc-hreflang`: Checking translation-pair integrity and detecting cross-language ranking.
- `site-growth-brief`: The multi-source, multi-site growth brief for plan generation.

### Modified Capabilities
<!-- None: openspec/specs/ is empty (OpenSpec was initialized with this change). The existing behavior of adsense_report and gsc_opportunities is captured as new capability specs that include the corrected requirements. -->

## Impact

- **MCP (`mcp/src/tools/`)**:
  - Changed: `adsense-report.ts`, `adsense-client.ts`, `gsc-opportunities.ts`.
  - New tools: `ga4-traffic-report.ts`, `gsc-url-hygiene.ts`, `gsc-hreflang.ts`, `site-growth-brief.ts`.
  - The GA4 Data API fetch in `ga4-consent-health.ts` is extracted into a shared `utils/ga4-data-client.ts`.
  - Registry entries are added per ADR-0003.
- **CLI (Go)**: New `ga4 gsc url-hygiene` and `ga4 gsc hreflang` subcommands. `ga4 gsc opportunities` gains `--granularity`. New pure diagnostics live in `internal/gsc/diagnostics/`.
- **Config**: Optional `search_console.hreflang_pairs` (resolves BACKLOG open question 5). The field is additive. The brief takes revenue from GA4's AdSense-linked metrics, so it needs no AdSense config.
- **Auth/scopes**: No new scopes. All four tools use `analytics.readonly`, `webmasters` and `adsense.readonly`, which are already documented in `mcp/PERMISSIONS.md`.
- **Docs**: `mcp/README.md` tool list, `CONTEXT.md` (the "16 tools" count and new vocabulary: *URL hygiene*, *anonymized share*, *growth brief*), `docs/BACKLOG.md` (BO-07 moves to implemented), and `mcp/CHANGELOG.md`.
- **Release**: Minor version bump of the MCP server. The narrowed AdSense enum is called out in the changelog.
