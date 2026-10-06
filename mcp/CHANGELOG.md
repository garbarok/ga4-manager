# Changelog

All notable changes to the GA4 Manager MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.4.0] - 2026-10-06

### Added

- **DataForSEO growth tools** — `llm_mentions` (does Google AI / ChatGPT cite a domain for given queries, and who it cites instead), `keyword_gap` (keywords a competitor ranks for and you don't), `ranked_keywords` (any domain's ranking keywords), `keyword_ideas` (ideas with keyword difficulty and search intent), `google_trends` (interest over time for up to 5 terms, with trend and peak), `backlinks_overview` (domain rank / backlinks / referring domains side by side), `link_gap` (domains linking to competitors but not you) and `dataforseo_balance` (free balance check).
- **`cost_usd` on every DataForSEO result** — including `keyword_volume` and `keyword_serp_snapshot` — so spend per call is visible. List tools default to 100 rows, max 1000.
- **`render_js` option on `seo_page_audit`/`seo_audit_batch`** — fetches the post-JavaScript DOM via Cloudflare Browser Rendering instead of a plain HTTP fetch, for auditing JS-rendered/SPA pages where a plain fetch misses content Google's own renderer sees. Needs `CF_ACCOUNT_ID`/`CF_API_TOKEN` (or per-call `cf_account_id`/`cf_api_token`); skips redirect-chain/status-code capture in this mode.
- **`keyword_volume`** — search volume, CPC and competition for a list of keywords, via DataForSEO (needs `DATAFORSEO_USERNAME`/`DATAFORSEO_PASSWORD`).
- **`keyword_serp_snapshot`** — ranked organic results for a keyword, via DataForSEO, for content-gap/competitive research.
- **`keyword_rank_check`** — a domain's live Google rank for a keyword today, via ValueSERP (needs `VALUESERP_API_KEY`); distinct from GSC's impression-weighted historical average position already in `site_growth_brief`.
- **`keyword_rank_check` AI Overview fallback (`check_ai_overview`, default true)** — when a domain misses classic organic results and Google shows an AI Overview for the query, checks whether the domain is cited there instead. A page can be exactly what Google surfaces for a query — and what GSC credits with a position — while being invisible to organic-only rank checks once an AI Overview has taken over the SERP. Costs one extra ValueSERP credit, only when the fallback actually triggers.

### Fixed

- **`gsc_health` no longer times out over MCP.** Priority URLs are inspected 5 at a time instead of serially (38 URLs: ~4.5 min → 54 s on a real site), the quota tracker is mutex-guarded for concurrent inspections, and CLI-backed tools can now override the executor's 30 s default (`gsc_health` uses 300 s).
- **`gsc_health` no longer reports a page as a regression just because Google gained a canonical for it.** Going from no canonical to one is what indexing looks like; it made a "Discovered" → indexed page show up as a regression. A canonical that moves from one URL to another is still a regression.

## [3.3.0] - 2026-09-27

### Added

- **`site_growth_brief`** — one compact brief per site (≤ ~4 KB) for writing SEO / monetization plans: GSC + GA4 traffic + AdSense-in-GA4 revenue KPIs with period-over-period deltas, top pages joined across sources and ranked by revenue, the top 10 diagnostic findings ranked by estimated clicks, and `data_gaps` for any source that was missing or failed. `config` for one site or `all: true` for every `configs/*.yaml`.
- **`ga4_traffic_report`** — GA4 Data API report by page / landing page / channel / source / country / device / date with sessions, engagement, page views and, when AdSense is linked to GA4, ad revenue, ad impressions, ad clicks and `revenue_per_1k_sessions`. Warns `ad_revenue_unavailable` when nothing is attributed.
- **`gsc_url_hygiene`** — URLs earning impressions that should not be indexed: `malformed_path`, `fragment`, `asset_route`, `query_duplicate`, `utility_page` (info), each with a one-line fix.
- **`gsc_hreflang`** — hreflang pair integrity (`missing_return_link`, `missing_self_reference`, `wrong_target`, `missing_x_default`) and `cross_language_ranking` detection. Pairs from `search_console.hreflang_pairs` or discovered from the site's own annotations.
- **`gsc_opportunities` `granularity: "page"`** — ranks whole pages, with `top_queries` and `anonymized_share`. Catches high-impression pages whose traffic is spread over anonymized long-tail queries; the expected CTR is floored at the industry baseline so weak neighbouring pages cannot hide an opportunity.
- **`adsense_report` `order_by`** — sort by any requested metric/dimension (`"-ESTIMATED_EARNINGS"`) before `limit`, for top-N breakdowns.

### Changed

- **BREAKING (never-working values only): `adsense_report` `date_range` no longer accepts `LAST_MONTH`, `LAST_3_MONTHS`, `LAST_6_MONTHS`, `LAST_12_MONTHS`, `LAST_YEAR`.** The AdSense v2 API rejects each with HTTP 400; the tool now returns `INVALID_INPUT` locally with a hint to use `CUSTOM` + `start_date`/`end_date`.

### Fixed

- AdSense and GA4 Data API HTTP 4xx errors (other than auth / not found / quota) were reported as `UPSTREAM_5XX`; they are now `INVALID_INPUT` with the upstream message. `ga4_consent_health` shares the new GA4 Data client and gets the same fix.

## [3.2.1] - 2026-07-16

### Fixed

- **Bundled `ga4` binary: `setup` no longer reports ✓/"Created" for resources rejected with 409 ALREADY_EXISTS.** GA4 display names are unique across custom dimensions AND metrics combined; a colliding create now surfaces as `○ <name> (conflict: already exists, skipping)` and counts as Skipped. Preflight additionally fails when a config reuses a display_name across the dimensions+metrics sections, and display names are validated against GA4's charset (letters, digits, underscores, spaces).

## [3.2.0] - 2026-06-26

### Added

- **AdSense publisher reporting tools.** Two read-only tools backed by the [AdSense Management API v2](https://developers.google.com/adsense/management/reference/rest), answering "how much do the ads *on my own site* earn" (publisher side — the opposite of the advertiser-side Google Ads API):
  - **`adsense_accounts_list`** — lists the AdSense accounts the authenticated identity can access; returns each account `name` (`accounts/pub-XXXXXXXXXXXXXXXX`) to use with the report tool.
  - **`adsense_report`** — generates an earnings report for one account (default: last 7 days; `ESTIMATED_EARNINGS`, `PAGE_VIEWS`, `IMPRESSIONS`, `CLICKS`, `IMPRESSIONS_RPM` by `DATE`), with `CUSTOM` date windows and arbitrary metric/dimension selection. Rows are returned as `header → value` maps plus totals.
- No developer token or Manager account is required (unlike Google Ads). Auth reuses the existing `getGoogleAuthHeaders` credential resolution with the new `https://www.googleapis.com/auth/adsense.readonly` scope; a new `utils/adsense-client.ts` handles REST + structured error mapping, mirroring the GSC native tools. See [PERMISSIONS.md → AdSense](PERMISSIONS.md#adsense) (use ADC user credentials — a service-account key cannot read a personal AdSense account).

## [3.1.0] - 2026-06-24

### Added

- **MCPB bundle packaging.** `npm run pack:mcpb` builds a self-contained `.mcpb` (compiled server + production `node_modules` staged via `pnpm deploy`, plus a prebuilt per-platform `ga4` binary) that installs in Claude Desktop without Node or Go. Credentials are supplied per-install through `manifest.json` `user_config` — no secrets are baked into the bundle. Pass a target to cross-compile, e.g. `npm run pack:mcpb linux/amd64`.

### Fixed

- **`gsc_analytics_run` and `gsc_index_coverage` now return their per-row arrays.** Both omitted `--format json` when calling the CLI (whose default format is `table`), so the table parser ran and silently dropped `rows[]` / `pages_sample[]`, leaving only aggregates regardless of the requested format. They now always request JSON, and JSON detection tolerates the CLI's status-line preamble.
- **`seo_page_audit` treats an empty `PSI_API_KEY` as unset.** The MCPB manifest always sets the env var, so an unconfigured key arrived as `""`; it no longer disables Core Web Vitals.
- **Test suite excludes `build/` and `dist-mcpb/`** so the staged bundle's vendored `*.test.ts` files (e.g. zod's) are not picked up.

### Changed

- **Removed the no-op `format` parameter** from `gsc_analytics_run` and `gsc_index_coverage`. These MCP tools always return structured JSON; the parameter never changed the result. Unknown keys are ignored, so callers still passing `format` are unaffected.

## [3.0.0] - 2026-06-24

### Changed

- **BREAKING: `ga4_link` is split into `ga4_link_list`, `ga4_link_create`, and `ga4_link_remove`.** A single tool may not mix safe (read) and unsafe (write/delete) operations under the Claude connector directory review rules. The old `list` / `unlink` flags are gone: list links with `ga4_link_list`, create with `ga4_link_create` (`service` now required), and unlink with `ga4_link_remove` (`service` is `bigquery` | `channels`). All three call the same `ga4 link` CLI command — no Go CLI change.
- **All tools now declare MCP `annotations`** (`title` plus `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`). These drive auto-permission behavior and are required for directory submission.
- **`seo_page_audit` / `seo_audit_batch` descriptions** now state they fetch user-supplied URLs over HTTP.

### Fixed

- **MCP server resolves the `ga4` binary from `PATH`** when neither `GA4_BINARY_PATH` nor the repo-root `ga4` is present. A globally installed `ga4` now works without a repo-root symlink. Resolution order: `GA4_BINARY_PATH` → repo-root `../../ga4` → `ga4` on `PATH`.
- **`serverInfo.version`** is now read from `package.json` instead of a hard-coded `1.0.0`.
- **Test suite no longer double-runs** the compiled `dist/**/*.test.js` copies (vitest now excludes `dist/`).
- **`gsc_sitemaps_list` parser tests** updated to the real CLI table format. The fixtures used a pipe-delimited table the CLI never emits (it renders space-padded `tabwriter` output); the parser was correct, the fixtures were stale.

## [2.4.0] - 2026-06-15

### Added

- **`seo_audit_batch` tool.** Audit many pages at once from an explicit `urls[]` list and/or a `sitemap` URL (sitemap-index files are followed and expanded). Runs the single-page auditor over each URL with bounded concurrency (same-host requests stay throttled to 1/sec for politeness) and returns per-URL results plus a summary (`audited`, `clean`, `pages_with_errors`, `total_error_issues`, `failed_fetch`). Honours `limit`, `concurrency`, `check_cwv`, `psi_strategy`, `psi_api_key`, `respect_robots`, `as_googlebot` (default `true`).

### Changed

- **`seo_page_audit` reads `PSI_API_KEY` from the environment.** Core Web Vitals now work without passing `psi_api_key` on every call — set `PSI_API_KEY` in the MCP server env (a per-call `psi_api_key` still takes precedence).
- **TROUBLESHOOTING: documented Mobile Usability and CWV false positives.** `MobileUsable: false` on every URL is an artifact of Google's deprecated Mobile Usability field (sunset Dec 2023), not a defect; `cwv_unavailable`/`psi_unavailable` means CWV were not measured, not that the page failed them.

## [1.0.0] - 2024-12-27

### Added

#### Core Infrastructure (Phase 1)
- MCP server initialization with stdio transport
- CLIExecutor class for spawning and managing ga4 binary subprocess
- ANSI color code stripper for clean output parsing
- Structured error handling with actionable suggestions
- TypeScript project setup with Vitest testing framework
- Comprehensive test suite with 593 passing tests

#### Output Parsing (Phase 2)
- OutputParser class with automatic format detection
- JSON output parsing with validation
- Table parsing (tablewriter format to structured arrays)
- CSV parsing with column header detection
- Markdown report parsing
- Smart format detection algorithm

#### GA4 Tools (Phase 3)
- **ga4_setup** - Setup GA4/GSC from YAML config with dry-run support
- **ga4_report** - Generate configuration reports (conversions, dimensions, metrics)
- **ga4_cleanup** - Remove unused conversions, dimensions, and metrics
- **ga4_link** - Manage external service integrations (BigQuery, Search Console, Channels)
- **ga4_validate** - Validate YAML configuration files with detailed error reporting

#### GSC Tools (Phase 4)
- **gsc_sitemaps_list** - List all sitemaps for a site
- **gsc_sitemaps_submit** - Submit new sitemap URLs
- **gsc_sitemaps_delete** - Remove sitemaps
- **gsc_sitemaps_get** - Get detailed sitemap information
- **gsc_inspect_url** - Inspect URL indexing status and mobile usability
- **gsc_analytics_run** - Generate search analytics reports with aggregates
- **gsc_monitor_urls** - Batch URL monitoring from config files

#### Documentation (Phase 5)
- Comprehensive README.md with usage examples
- CONFIGURATION.md with complete YAML reference
- CHANGELOG.md for version tracking
- Inline code documentation with JSDoc
- Troubleshooting guide for common issues

#### Features
- Structured JSON responses for all tools
- Dry-run mode for setup and cleanup operations
- Quota tracking for GSC API operations
- Error handling with exit codes and suggestions
- Support for multiple output formats (JSON, table, CSV, markdown)
- Automatic ANSI code stripping from CLI output
- Comprehensive input validation with Zod schemas
- Tool metadata with descriptions and input schemas

#### Testing
- 593 unit and integration tests
- Test coverage for all 12 tools
- CLI executor tests with mocked subprocesses
- Output parser tests with sample data
- Error handling tests for common scenarios
- Vitest configuration with coverage reporting

#### Developer Experience
- TypeScript with strict type checking
- ESLint configuration for code quality
- npm scripts for build, dev, and testing
- Clear error messages with actionable suggestions
- Modular architecture with separation of concerns

### Technical Details

#### Dependencies
- `@modelcontextprotocol/sdk` v1.25.1 - MCP protocol implementation
- `zod` v4.2.1 - Runtime type validation
- `csv-parse` v6.1.0 - CSV parsing
- `typescript` v5.9.3 - Type safety
- `vitest` v4.0.16 - Testing framework
- `eslint` v9.39.2 - Code linting

#### Architecture
```
mcp/
├── src/index.ts          - MCP server entry point
├── src/cli/              - CLI execution layer
├── src/tools/            - 12 tool implementations
├── src/utils/            - Utilities (ANSI strip, errors)
├── src/types/            - TypeScript type definitions
└── tests/                - 593 comprehensive tests
```

#### Performance
- Average tool execution time: 1-5 seconds
- CLI subprocess timeout: 30 seconds (default), 5 minutes (max)
- Minimal memory footprint: <50MB
- Fast startup time: <500ms

### Known Limitations
- GSC API quota: 2,000 queries/day (Google-imposed limit)
- BigQuery links: List-only support (API limitation)
- Audiences: Cannot be created programmatically (API limitation)
- Search Console links: Manual setup required (API limitation)

### Migration Guide
- First release - no migration needed

### Contributors
- Initial implementation by Claude Code (MCP Agent)
- GA4 Manager CLI by @garbarok

---

## [Unreleased]

### Planned
- Caching layer for repeated queries
- Batch operation support for multiple configs
- Enhanced analytics with insights and recommendations
- Performance monitoring and metrics
- Extended error recovery with retry logic
- Support for custom channel group templates

---

## Version Comparison

| Version | Tools | Tests | Features |
|---------|-------|-------|----------|
| 1.0.0   | 12    | 593   | Complete MCP implementation |

---

For detailed tool documentation, see [README.md](./README.md).
For configuration reference, see [CONFIGURATION.md](./CONFIGURATION.md).
