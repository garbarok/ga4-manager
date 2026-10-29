# Tasks

## 1. Shared error classification

- [x] 1.1 Add `errorCodeForStatus(status)` to `mcp/src/utils/errors.ts`: 401/403→AUTH_DENIED, 404→NOT_FOUND, 429→QUOTA_EXCEEDED, other 4xx→INVALID_INPUT, 5xx→UPSTREAM_5XX. Verify with a table-driven test in `errors.test.ts` covering 400, 401, 403, 404, 422, 429, 500 and 503.
- [x] 1.2 Route `mapAdsenseError` in `adsense-client.ts` through `errorCodeForStatus`, keeping the existing hints. Verify with a test where a mocked HTTP 400 yields `INVALID_INPUT` with the upstream message, and 503 yields `UPSTREAM_5XX`.

## 2. adsense_report fixes

- [x] 2.1 Narrow `DATE_RANGES` to CUSTOM, TODAY, YESTERDAY, MONTH_TO_DATE, YEAR_TO_DATE, LAST_7_DAYS and LAST_30_DAYS, in both the zod schema and the JSON-schema enum. Add a hint pointing to `CUSTOM`. Verify with tests that `LAST_3_MONTHS` returns INVALID_INPUT without calling `fetch`, and that the advertised enum equals the zod enum.
- [x] 2.2 Add an `order_by: string[]` input. Validate that each stripped column is in `metrics ∪ dimensions`, and pass entries as repeated `orderBy` params. Verify with tests: repeated params in the request URL; an unknown column gives INVALID_INPUT; omitting it sends no `orderBy` param.
- [x] 2.3 Update the tool description and `mcp/README.md` AdSense section with `order_by` and the valid presets. Then call `adsense_report` live with `dimensions: ["COUNTRY_NAME"], order_by: ["-PAGE_VIEWS"], limit: 3, date_range: "LAST_30_DAYS"` and confirm the rows come back in descending page-view order.

## 3. GA4 Data client and ga4_traffic_report

- [x] 3.1 Extract `mcp/src/utils/ga4-data-client.ts` (`runReport(propertyId, body)`) from `ga4-consent-health.ts`, using `errorCodeForStatus`. Verify that the existing `ga4-consent-health.test.ts` passes unchanged and a new client test covers the 400→INVALID_INPUT mapping.
- [x] 3.2 Implement `mcp/src/tools/ga4-traffic-report.ts` as a `native()` spec with inputs `property_id | config`, `days`, `dimensions`, `order_by` and `limit`. Map the rows to the spec's metric names, compute `revenue_per_1k_sessions`, and add the `ad_revenue_unavailable` warning. Verify with fixture-based tests for: default page report, a linked-revenue fixture, an unlinked (zero ad impressions) fixture, a G-ID rejection, and ordering by `ad_revenue`.
- [x] 3.3 Register the tool in `registry.ts` and bump the count assertion in `registry.test.ts`. Verify that `npm run test:run` and `npm run lint` pass in `mcp/`.

## 4. ga4 config resolve (Go)

- [x] 4.1 Add `search_console.hreflang_pairs` (`[]map[string]string`) to `internal/config/types.go`, with loader validation that every value is an absolute URL on the site's host. Verify with `types_test.go` cases for a valid pair, a relative URL and an off-host URL.
- [x] 4.2 Add `cmd/config_resolve.go`: `ga4 config resolve --config <path> | --all --format json`, emitting `[{path, project, property_id, gsc_site, hreflang_pairs}]`, with `--all` excluding `configs/examples/`. Verify with a Go test on the `testdata` configs and a manual `./ga4 config resolve --all --format json`, which must list `configs/mysite.yaml` and no examples.
- [x] 4.3 Wire `config` input in `ga4_traffic_report` through the executor calling `config resolve`. Verify with a test using a mocked executor that returns a resolved property ID.

## 5. Page-mode opportunities

- [x] 5.1 Add `OpportunityWith(rows, OpportunityOptions{MinPeers})` to `diagnostics`. `Opportunity(rows)` keeps `MinPeers: 2`; the impression floor stays in the command, which filters rows before the predicate. Verify that the existing `opportunity_test.go` passes unchanged, which proves query mode is byte-identical.
- [x] 5.2 Add page-mode tests to `opportunity_test.go`: a large page with only low-impression peers falls back to the baseline; a legal page below the floor is excluded from peers; a bucket with ≥3 qualifying peers uses the site median. Verify with `go test ./internal/gsc/diagnostics/...`.
- [x] 5.3 Add `--granularity query|page` to `cmd/gsc_opportunities.go`. Page mode makes the page call plus the query×page call, attaches `top_queries` (top 5 by impressions) and `anonymized_share`, and sets `quota_used: 2`. Verify with a `cmd` test using a stubbed Search Analytics client, checking fields, clamping of `anonymized_share` to [0, 1], and quota.
- [x] 5.4 Add `BaselineFloor` to `OpportunityOptions` (page mode: expected CTR = max(site median, baseline)). Verify with diagnostics tests for a 0%-median bucket still flagging a page against the baseline, and a site median above the baseline being kept as `site`.
- [x] 5.5 Add `granularity` to `mcp/src/tools/gsc-opportunities.ts` (schema, args, output types for `top_queries`/`anonymized_share`). Verify with MCP tests for arg building and parsing, then a live run on a real site config with `granularity: "page"`, `days: 90`, where the highest-impression under-converting page must be the first result.

## 6. URL hygiene diagnostic

- [x] 6.1 Implement `internal/gsc/diagnostics/url_hygiene.go`: the ordered classifier (malformed_path, fragment, asset_route, query_duplicate, utility_page), severity, and per-issue `fix` text. Verify with table-driven tests covering every spec scenario, including an OG-image URL with a query string classified as `asset_route`.
- [x] 6.2 Add `cmd/gsc_url_hygiene.go` (`ga4 gsc url-hygiene --config --days --format`) using `diagcmd`: exit 2 on any warning, 0 on info-only or no findings, `quota_used: 1`. Verify with a cmd test for exit codes and a live run on a real site config, which must report its known malformed path, `#` fragments and `opengraph-image` routes.
- [x] 6.3 Add `mcp/src/tools/gsc-url-hygiene.ts` as a `cli()` spec and register it. Verify with MCP parse tests and a registry count update.

## 7. Hreflang diagnostic

- [x] 7.1 Add an own-host HTTP probe in `internal/gsc/httpprobe/`: `ga4-manager/<version>` User-Agent, 4 concurrent requests, 10 s timeout, max 5 redirects, off-host URLs refused. Parse `<link rel=alternate hreflang>` with `golang.org/x/net/html`, promoted to a direct dependency in `go.mod`. Verify with `httptest.Server` tests for alternates parsing, redirect cap and off-host refusal.
- [x] 7.2 Implement `internal/gsc/diagnostics/query_language.go`: a stopword/diacritic scorer for en, es, pt, fr and de, restricted to candidate languages, with a margin ≥1 or skip. Verify with tests covering representative queries (e.g. "how much house can i afford calculator" → en; "simulador hipoteca" → es; "zillow" → skip).
- [x] 7.3 Implement `internal/gsc/diagnostics/hreflang.go`: the missing_return_link, missing_self_reference, wrong_target, missing_x_default, cross_language_ranking and no_hreflang checks over fetched annotations and query×page rows. Verify with fixture tests, one per spec scenario.
- [x] 7.4 Add `cmd/gsc_hreflang.go` (`ga4 gsc hreflang --config --days --max-pages --min-impressions --format`) with config pairs or discovery, and report `pages_fetched` and `quota_used`. Verify with a cmd test using stubbed probe and client, then a live run on a real site config with an en/es pair declared in `hreflang_pairs`.
- [x] 7.5 Add `mcp/src/tools/gsc-hreflang.ts` as a `cli()` spec and register it. Verify with MCP parse tests and the registry count.

## 8. site_growth_brief

- [x] 8.1 Implement path normalization and the GSC↔GA4 page join as a pure module (`compute-growth-brief.ts`). Verify with tests: fragment variants collapse, one-source pages keep nulls, and ranking is by revenue then clicks.
- [x] 8.2 Implement the findings digest (normalize opportunities, CTR anomalies, hygiene and hreflang into `{source, summary, page, impact}`, cap at 10, order by impact) and KPI deltas. Verify with pure-function tests including a null-impact item ordered last.
- [x] 8.3 Implement `mcp/src/tools/site-growth-brief.ts` as a `native()` spec that orchestrates per design D9, with per-step failure capture into `data_gaps`, per-API `quota_used`, and `success: false` only when every source fails. Verify with tests using a mocked executor and GA4 client: an unlinked-AdSense gap, a missing-GSC gap, and all sources failing.
- [x] 8.4 Add a size-budget test asserting that a fully populated brief fixture serializes to ≤ 4 KB. Register the tool, then run it live with `all: true` and confirm it produces one brief per non-example config, with the top finding being that site's largest page-level opportunity.

## 9. Docs and release

- [x] 9.1 Update `mcp/README.md` (tool list and count), `mcp/PERMISSIONS.md` (the GA4 traffic tool uses `analytics.readonly`), `CONTEXT.md` (tool count, and the terms *URL hygiene*, *anonymized share* and *growth brief*), and `docs/BACKLOG.md` (BO-07 implemented; open questions 1 and 5 resolved per design D7). Verify with `grep -n "16" CONTEXT.md mcp/README.md`, which should show no stale tool count.
- [x] 9.2 Add `mcp/CHANGELOG.md` and root `CHANGELOG.md` entries (the AdSense enum narrowing marked BREAKING) and bump the MCP minor version. Rebuild the binary and MCPB. Verify that `make test`, `make lint`, `npm run test:run` and `npm run pack:mcpb` all succeed, and that the packed server's `tools/list` includes the four new tools. (The MCPB manifest does not enumerate tools; its version is synced from package.json at pack time.)
