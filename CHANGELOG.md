# Changelog

All notable changes to GA4 Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- `ga4 doctor` subcommand — preflight checks for credentials, scopes, API enablement, and per-resource access
- Priority filtering (`--priority high/medium/low`)
- Incremental updates for partial updates

## [2.4.0] - 2026-06-15

### SEO auditing + false-positive hardening

#### Added

- **`gsc audit-urls` — live HTTP audit of indexed + sitemap URLs.** Unions the pages GSC has search impressions for with every `<loc>` in the sitemap (sitemap-index files are followed), then probes each over HTTP, following redirects manually, and classifies the outcome:
  - `ok` — terminal 2xx, no redirect
  - `redirect` — reached 2xx via redirects; trailing-slash mismatches (requested URL is not the canonical slash form) are surfaced as issues
  - `broken` — terminal status ≥ 400 (e.g. a renamed page whose old URL is still indexed but now 404s)
  - `blocked` — 401/403/429; reported but **not** treated as a failure, since these are usually CDN bot-protection/rate-limiting from a non-Google IP
  - `error` — transport failure
  Exits `2` when any broken/error URL is found. Flags: `--source` (both/sitemap/gsc), `--days`, `--min-impressions`, `--limit`, `--concurrency`, `--timeout`, `--user-agent` (defaults to Googlebot), `--format` (table/json). Catches the class of problem the Search Console API alone cannot see.
- **`gsc whoami` — authenticated identity + per-property permissions.** Reports the service-account email and GCP project, plus each accessible property's permission level and whether it allows writes. Run it first when a write command returns `403`.

#### Changed

- **Write commands now preflight permissions.** `gsc sitemaps submit`/`delete` check the property permission level before calling the API and fail with an actionable message (read-only access → how to grant Full access) instead of a bare `403`.
- **`gsc cannibalization` is language-aware.** Findings whose pages are hreflang translations of one another (distinct locales, no single locale holding ≥2 pages) are **excluded by default** as false positives; a genuine same-language pair (plus any translations) is still reported. Pass `--include-cross-language` to show the excluded findings. JSON output gains a `cross_language` field.
- **Mobile Usability is no longer reported as a failure.** Google deprecated the Mobile Usability report/API field in December 2023. `gsc inspect`/`monitor`/`health` now trust the verdict only when a real PASS/FAIL/PARTIAL is returned; the deprecated empty verdict shows as "n/a (deprecated)" and is no longer diffed as a health regression.
- **CLI flags now override config in `gsc analytics run`.** An explicitly-set `--days`/`--dimensions`/`--site` wins over the config's `search_analytics` values (previously config silently overrode the flag).
- **`gsc analytics run` paginates.** `--limit` accepts up to 100000 rows, fetched via `StartRow` pagination in 25000-row pages; the default was raised 100 → 1000.

## [2.3.1] - 2026-06-05

### Polish — small-site usability for the diagnostic family

#### Changed

- **`gsc opportunities` default `--min-potential-clicks` 0 → 1.** Suppresses 0-click rounding-error findings on small sites. Pass `--min-potential-clicks 0` to restore the previous "surface everything" behaviour. Same default change mirrored in the matching MCP arg.
- **`gsc analytics run` default `--days` 30 → 28.** Aligns with the diagnostic-command default and with GSC's standard reporting window. Pass `--days 30` explicitly to keep the old value.

#### Added

- **`gsc ctr-anomaly` sparse-data warning.** When the joined sample falls below the threshold (currently 5 pairs after the `--min-clicks-prior` filter) and zero anomalies came back, the command emits a stderr warning explaining that `0 anomalies` reflects insufficient data, with a remediation hint to widen `--days` or lower `--min-clicks-prior`. JSON output on stdout is unchanged; the warning is stderr-only so structured consumers never see it.

## [2.3.0] - 2026-06-05

### GSC Diagnostics framework: four production-grade SEO commands + shared substrate

#### Added

**Four new diagnostic commands (CLI + MCP at parity)**
- `ga4 gsc cannibalization` / `gsc_cannibalization` — detect queries where ≥2 pages on the same site each clear an impression threshold, splitting authority. Supports `--with-coverage-state` (per-page URL Inspection with severity tiering: `actionable` vs `consolidating`), `--only-actionable` (cron-friendly filter that drops in-flight migrations), `--days N` lookback, and the redirect-aware `canonical_candidate` heuristic that auto-corrects to the impression leader among non-redirect pages.
- `ga4 gsc opportunities` / `gsc_opportunities` — surface queries ranking position 5–20 whose CTR is below the peer median (position-bucket curve), ranked by `potential_clicks` — the absolute monthly clicks the page would gain at median CTR. Falls back to a published industry-baseline CTR curve when the site has too few peers in a bucket to compute its own median, so small-site Operators get useful output before they have enough traffic for per-site medians.
- `ga4 gsc ctr-anomaly` / `gsc_ctr_anomaly` — compare two consecutive windows of search analytics, surface (query, page) pairs whose position barely moved but whose CTR collapsed ≥30%. Signals snippet rot — title/meta no longer converting against the SERP. Sorted by `clicks_lost` descending.
- `ga4 gsc health` / `gsc_health` — first state-bearing command. Inspects priority URLs from config, diffs against a JSON snapshot per ADR-0005, surfaces regressions / recoveries / baselines. Silent on all-green so a weekly cron only fires when something regresses (noindex bugs, coverage-state changes, canonical mismatches, mobile-usability or rich-result failures).

**Shared framework (`internal/gsc/diagcmd`)**
- `Envelope[T]` generic for JSON output, `Render` dispatcher, `ExitCode` / `ValidateFormat` / `LoadSite` / `FailWith` helpers. The four conventions every diagnostic command honours (exit 0/1/2 semantics, `--format table|json`, silent-on-all-green, quota footer) are defined in one module rather than reimplemented per command.

**Shared renderer (`internal/render`)**
- One generic `Render[T]` function with three format adapters (table / csv / markdown). Replaces seven cmd files' worth of hand-rolled `tablewriter` + format-switch logic; the `olekukonko/tablewriter` dependency was removed from the project as a result. JSON output stays per-command because envelope shapes are command-specific (analytics has aggregates, diagnostics have results, etc.).

**State storage (`internal/gsc/state`, ADR-0005)**
- Schema-versioned JSON snapshots per `(command, gsc_site)` pair, atomic temp-file-plus-rename, typed errors (`ErrSnapshotMissing`, `ErrSchemaVersionMismatch`, `ErrInvalidKey`), `ResolveStateDir` helper, injectable `renameFn` test seam. First consumer is `gsc_health`; future state-bearing diagnostics plug in here.

**GSC client interfaces (`internal/gsc.SearchAPI`, `internal/gsc.InspectAPI`)**
- Narrow consumer-facing interfaces over `*Client`. Mirrors the `internal/ga4` adminAPI/fakeAdminAPI seam. Quota usage now travels alongside the data it cost (`SearchAnalyticsReport.QuotaUsed`) rather than via a separate state read.

**CONTEXT.md and ADRs**
- "Operator" defined as the central actor (the person running this CLI against their own properties).
- "SEO Diagnostics" section codifies the four canonical signals as strict, mutually-exclusive predicates (Decay, CTR anomaly, Opportunity, Cannibalisation).
- ADR-0005 captures the state-storage architecture decision.

#### Fixed

- **MCP swallowed stdout on exit 2.** The dispatch layer treated any non-zero exit as `CLI_EXECUTION_FAILED`, so success-with-findings (the entire point of diagnostic commands) returned only stderr. `SUCCESS_EXIT_CODES = {0, 2}` now treats exit 2 as success at the MCP layer; exit 1 and unexpected codes still route to `mapCLIError`.
- **Opaque `spawn .../ga4 ENOENT` on first MCP call after a fresh clone.** `CLIExecutor` now validates the binary at construction and throws a clear remediation hint pointing at `make build` / `go build -o ga4 .` and the `GA4_BINARY_PATH` override.
- **Cannibalisation `canonical_candidate` could point at a redirect target** for sites mid-migration (GSC still attributes impressions to the legacy URL inside its 28-day window). The field now auto-corrects to the impression leader among non-redirect pages when `--with-coverage-state` is set.

#### Changed

- Format vocabulary unified across the codebase: `table | csv | markdown`. The previously-shipped diagnostic flag value `text` is now `table`; `cmd/report.go`'s `md` alias is removed (use `markdown`).
- `gsc_cannibalization` always passes `--min-impressions` so the MCP and Go defaults can never silently diverge.
- Stale `internal/seo/webvitals.go` (190 LOC, zero consumers) deleted. BO-09 CWV monitoring remains deferred until CrUX coverage is available, and will be designed fresh when picked up.
- Removed automatic PR review (Claude + CodeRabbit). Code review responsibility moves to the maintainer plus the local `/code-review` and `/thermo-nuclear-code-quality-review` skills.

#### Tests

- Go: full suite green, including new packages `internal/gsc/diagcmd`, `internal/gsc/state`, `internal/gsc/diagnostics`, `internal/render`, plus per-command CLI test files for all four new diagnostics.
- MCP: 1432 tests pass (up from 1341 at the start of the cycle).
- `go vet ./...` clean, `make lint` clean (only pre-existing vendored `node_modules/flatted` govet warnings).

## [2.2.0] - 2026-04-25

### Diagnostic & SEO MCP tools + onboarding overhaul

#### Added

**Three new MCP tools (16 total)**
- `gsc_traffic_compare` — diff GSC search analytics between two date ranges per URL, surface biggest drops/gains. Configurable URL normalization, fetch/output limits, tail summary stats, parallel period fetch with structured `PARTIAL_FETCH_FAILED` error code, configurable sort modes, `min_clicks_a` filter.
- `ga4_consent_health` — events-based consent banner health: `consent_rate_pct`, `consent_visibility_pct`, health score from instrumented `consent_granted` / `consent_denied` events. (Consent Mode v2 dimensions are not exposed on the GA4 Data API; this tool counts custom events instead.)
- `seo_page_audit` — single-URL on-page SEO audit: title/description char + pixel-width checks, canonical severity escalation by registrable domain distance, JSON-LD `@graph` extraction, redirect chain tracing with loop/cross-domain/non-permanent flags, `meta-refresh` detection, robots.txt respect, per-host throttle, optional Core Web Vitals via PageSpeed Insights with bottleneck rate-limiting and 5-minute cache.

**Onboarding & docs**
- `scripts/setup.sh` — one-shot interactive setup: prereq check, ADC vs SA decision, scoped `gcloud` auth, quota project setup, four-API enablement, smoke tests, manual-step reminders. Idempotent and re-runnable.
- `mcp/TROUBLESHOOTING.md` — every error message you might see during setup or runtime, mapped to the exact fix.
- `mcp/PERMISSIONS.md` — expanded with ADC vs service account decision matrix and the explicit gcloud commands for each path.
- README — rewritten lean (133 lines, was 663) with 30-second quick-start at top.
- `mcp/scripts/provision-ga4-access.ts` — batch GA4 Viewer provisioning via the Admin API (covers the GSC manual-only gap with a programmatic GA4 alternative).

**Shared utilities (used across the new tools)**
- `mcp/src/utils/google-auth.ts` — JWT auth with scope-keyed in-memory token cache.
- `mcp/src/utils/cache.ts` — generic `TTLCache<V>` with lazy expiry.
- `mcp/src/utils/errors.ts` — `ToolError` + `ErrorCode` enum, standardized response shape (`success` / `warnings` / `error: { code, message, hint }`).
- `mcp/src/utils/url-normalize.ts` — pure URL normalization (`none` / `minimal` / `aggressive`) plus GSC site format flexibility (`sc-domain:`, URL-prefix, raw domain) and GA4 Property ID normalization with explicit Measurement-ID and UA-ID error hints.
- `mcp/src/utils/pixel-width.ts` — Arial-13px width estimation table for SERP truncation checks.
- `mcp/src/utils/redirect-trace.ts` — manual redirect handling with chain reporting (max 5 hops, loop detection).
- `mcp/src/utils/robots-check.ts` — robots.txt fetcher with per-origin TTL cache.

#### Changed

- `mcp/CONFIGURATION.md` — env vars unchanged; new tools reuse `GOOGLE_APPLICATION_CREDENTIALS`. Updated to list the three new tools alongside the 13 existing.
- `mcp/package.json` — version bumped to 2.2.0; added `google-auth-library`, `node-html-parser`, `robots-parser`, `tldts`, `bottleneck`.

#### Removed

- 10 per-issue `progress-*.txt` artifacts at repo root (Ralph autonomous-loop iteration memory; not permanent docs).

## [2.1.0] - 2025-12-28

### Major UX Improvements & Architecture Refactoring

#### Added

**Auto-Install System**
- First-run binary installation with sudo transparency and user consent
- Automatic binary placement in `/usr/local/bin` (user-approved)
- Shell-specific fallback instructions (Fish, Zsh, Bash) when auto-install is declined
- Smart detection: skips in dev environments (git repos) or if already installed
- Professional onboarding: download binary → run once → everything configured

**Auto-Config Creation**
- Embedded configuration templates compiled into binary (zero external dependencies)
- Automatic creation of `~/.config/ga4/configs/` directory on first run
- Three example configs: minimal, ecommerce, content site
- No manual file downloads or directory setup required

**Report Export**
- JSON export: Full structured data with all fields
- CSV export: Separate files for conversions, dimensions, metrics
- Markdown export: Human-readable formatted tables
- CLI mode: `--output` and `--format` flags for scripting
- Interactive mode: Export from report viewing menu
- Proper file handle cleanup with named returns (critical bug fix)

**Enhanced TUI**
- Complete interactive menu system built with Bubble Tea framework
- Link management: Search Console, BigQuery, Channel Groups
- Channel group operations: create, list, update, delete
- Setup wizards with real-time progress indicators
- Consistent styling across all interactive components
- Improved navigation and user feedback

**Configuration Validation**
- Implemented `ga4 validate` command for pre-flight checks
- Validates YAML syntax, property IDs, event names, parameter names
- Checks for reserved prefixes (google_, ga_, firebase_)
- Provides actionable error messages with line numbers

#### Changed

**SOLID Architecture Refactoring**
- Split 500+ line `cmd/interactive.go` into 7 focused handlers:
  - `handler_setup.go` - Setup operations (39 lines)
  - `handler_report.go` - Report viewing and export (98 lines)
  - `handler_cleanup.go` - Cleanup operations (44 lines)
  - `handler_link.go` - External service links (291 lines)
  - `handler_export.go` - Export functionality (70 lines)
  - `handler_validate.go` - Config validation (39 lines)
- Each handler follows Single Responsibility Principle
- Improved testability and maintainability
- Clearer separation of concerns

**Enhanced Error Handling**
- Fixed critical CSV resource leak (named return for proper error handling)
- Fixed path traversal panic risk (bounds check + filepath.Join)
- Better error context throughout codebase

#### Fixed

**Critical Security Issues**
- **CSV Resource Leak** (cmd/export.go:246-256): Used named return to ensure file.Close() error is properly handled
- **Path Traversal Panic** (cmd/init.go:89-96): Added bounds checking and proper path joining to prevent panic on empty credential paths

**Code Quality**
- All errcheck warnings resolved
- All staticcheck issues fixed
- All govet warnings addressed
- Zero linter issues

#### Testing

**New Test Suite**
- `cmd/export_test.go` with 5 test functions and 15+ test cases:
  - TestExportToJSON (valid data, empty data)
  - TestExportToCSV (valid data, empty conversions)
  - TestExportToMarkdown (valid data)
  - TestWriteCSV (conversion/dimension/metric data)
  - TestWriteCSV_VerifyFileClose (resource cleanup verification)
- All 100+ tests passing across entire codebase
- Cross-platform CI validation (macOS, Linux, Windows)

#### Documentation

**New Documentation**
- `docs/REFACTORING_INTERACTIVE.md` - Architecture decisions and patterns
- `cmd/configs/README.md` - Configuration guide with examples
- Updated README.md with auto-install and export features
- Updated .goreleaser.yaml with new release workflow

#### Impact

**User Experience**
- Onboarding reduced from 7+ manual steps to 2 commands
- Zero breaking changes - fully backward compatible
- Professional first-run experience with clear guidance
- Export capabilities for reporting and analysis

**Developer Experience**
- Easier to add new interactive features
- Clear separation of concerns for maintainability
- Comprehensive test coverage for new functionality
- Better code organization following SOLID principles

#### Files Changed
- **Added**: 18 new files (+3,769 lines)
- **Modified**: 8 files (-17 lines)
- **Total**: 25 files changed

#### CI/CD Status
✅ All checks passing:
- Build, Lint, Tests (macOS/Linux/Windows)
- Security scans (Trivy, gosec, vulnerability checks)
- CodeRabbit AI review: APPROVED

### Commits
- `bd3ea9c` - feat: Auto-install, export reports, and refactor interactive mode (#17)

## [1.1.0] - 2025-11-22

### Infrastructure & Tooling Improvements

#### Added
- **CI/CD Pipeline**: Comprehensive GitHub Actions workflows for automated testing, security scanning, and releases
- **Multi-Platform Testing**: Automated testing on Linux, macOS, and Windows
- **Security Scanning**: Weekly automated vulnerability scanning (govulncheck, gosec, trivy)
- **GoReleaser Integration**: Automated multi-platform binary releases
- **golangci-lint v2.6.2**: Code quality enforcement with golangci-lint-action v7

#### Changed
- **Go 1.25 Required**: Updated from Go 1.24 (which didn't exist) to Go 1.25
- **Dependencies Updated**:
  - `github.com/fatih/color` v1.16.0 → v1.18.0
  - `github.com/spf13/cobra` v1.8.0 → v1.9.1
  - `google.golang.org/api` v0.155.0 → v0.223.0
  - Added 200+ transitive dependencies from golangci-lint tooling

#### Fixed
- **Windows CI Tests**: Added `shell: bash` to fix PowerShell argument parsing issues
- **Race Detector**: Disabled on Windows (CGO limitations)
- **Lint Action**: Updated to golangci-lint-action v7 for v2.x linter support

#### CI/CD Features
- Test matrix: Go 1.25 on ubuntu-latest, macos-latest, windows-latest
- Security: Weekly automated scans for vulnerabilities
- Release: Automated multi-platform binary building with GoReleaser
- Lint: golangci-lint v2.6.2 with comprehensive checks

#### Notes
- **No functional changes** to CLI tool - same features as v1.0.0
- All changes are infrastructure and build improvements
- Binary functionality identical to v1.0.0
- Improved code quality and release automation

### Commits
- `fed29b0` - feat(ci): add comprehensive CI/CD pipeline with Go 1.25 support

## [1.0.0] - 2025-11-22

### Added
- **Release Automation**: GitHub Actions workflow for automated multi-platform binary building
- **Version Support**: Version injection via ldflags, accessible via `--version` flag
- **Code Quality**: golangci-lint integration with comprehensive linting rules
- **Production Features**: Rate limiting, structured logging, input validation, timeout configuration
- **Dry-Run Mode**: Preview changes before applying with `--dry-run` flag
- **Configuration Profiles**: Default, Production, and Development client configurations
- **YAML Configuration**: Support for external YAML configuration files via `--config` flag
- **Cleanup Command**: Remove unused conversions and dimensions with confirmation prompts
- **Link Command**: Manage external service integrations (Search Console, BigQuery, Channel Groups)
- **Data Retention**: Configure GA4 data retention settings
- **Enhanced Measurement**: Configure auto-tracking features (page views, scrolls, clicks, etc.)
- **Audience Documentation**: Comprehensive audience setup guides (API cannot create audiences)

### Fixed
- **BigQuery API Types**: Removed non-existent `Dataset` field from `BigQueryLink` struct
- **Channel Groups API**: Fixed filter types (`InListFilter`, `StringFilter`, `FilterExpressions`)
- **Link Command**: Replaced non-existent `config.GetProject()` with proper switch statement
- **Error Handling**: Fixed all unchecked error returns from color print functions
- **Boolean Comparisons**: Simplified `group.SystemDefined == true` to `group.SystemDefined`
- **Code Quality**: Fixed unnecessary `fmt.Sprintf` usage and capitalized error strings

### Changed
- Updated all error messages to include full context (operation name, property ID, resource names)
- Enhanced logging with structured key-value pairs for better observability
- Improved validation error messages with detailed explanations

### Build & Release
- Multi-platform binaries: Linux (amd64, arm64), macOS (Intel, Apple Silicon), Windows (amd64)
- Automated binary compression (.tar.gz for Unix, .zip for Windows)
- Auto-generated release notes from commits
- Parallel builds for faster release creation (~1 minute total)
- Version injection from git tags

### Documentation
- Comprehensive README.md with feature overview and quick start
- INSTALL.md with detailed installation instructions for all platforms
- SECURITY.md with security best practices
- CLAUDE.md with development documentation and AI guidance
- configs/examples/README.md with YAML configuration guide

### Supported Platforms
- macOS (Apple Silicon arm64)
- macOS (Intel amd64)
- Linux (x86_64 amd64)
- Linux (ARM64)
- Windows (x86_64 amd64)

### Commits
- `acb6f25` - feat: improve credential setup UX for binary downloads
- `4b9274f` - docs: add comprehensive installation guide
- `b9c913b` - feat: production-ready release with security, tests, and docs
- `48580c6` - docs: Document release workflow in CLAUDE.md

### Known Limitations
- **Audiences**: Cannot be created via API (complex filter logic), must be configured manually in GA4 UI
- **Search Console Links**: GA4 Admin API does not support programmatic creation, manual setup required
- **BigQuery Links**: Partially supported - can list/retrieve but cannot create/delete via API
- **Archived Dimensions/Metrics**: Parameter names are permanently reserved in GA4 even after archiving

## [0.9.0] - 2025-11-21 (Pre-release)

### Added
- Initial CLI implementation with Cobra framework
- GA4 Admin API integration for conversions, dimensions, and metrics
- Basic setup and report commands
- Hardcoded project configurations for initial development
- Core Web Vitals dimension support
- Custom metrics and calculated metrics support

### Technical Foundation
- Go 1.21+ requirement
- Google Analytics Admin API v1alpha client
- Color-coded terminal output
- Table-formatted configuration reports
- Environment variable support (.env file loading)

## Version History Summary

- **v1.1.0** (2025-11-22): Infrastructure & tooling improvements - CI/CD pipeline, Go 1.25 support, multi-platform testing, security scanning
- **v1.0.0** (2025-11-22): First public release with production features, multi-platform binaries, and comprehensive documentation
- **v0.9.0** (2025-11-21): Pre-release development version

---

## Release Notes Format

### Version Header
- Version number follows [Semantic Versioning](https://semver.org/)
- Release date in ISO format (YYYY-MM-DD)

### Sections
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements

### Links
- [Unreleased]: https://github.com/garbarok/ga4-manager/compare/v2.2.0...HEAD
- [2.2.0]: https://github.com/garbarok/ga4-manager/compare/v2.1.0...v2.2.0
- [2.1.0]: https://github.com/garbarok/ga4-manager/compare/v2.0.0...v2.1.0
- [1.1.0]: https://github.com/garbarok/ga4-manager/compare/v1.0.0...v1.1.0
- [1.0.0]: https://github.com/garbarok/ga4-manager/releases/tag/v1.0.0
