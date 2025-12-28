# Changelog

All notable changes to the GA4 Manager MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-12-28

### Added

- **gsc_index_coverage** - New tool for analyzing index coverage from Search Console
  - Impression-based classification (≥10 = indexed, 1-9 = low visibility, 0 = not indexed)
  - Sample limit of 1,000 pages for performance
  - Supports multiple date ranges and aggregations

### Changed

- **BREAKING**: Enhanced mobile usability structure in `gsc_inspect_url`
  - Mobile issues now return structured `MobileUsabilityIssue[]` with `issue_type`, `severity`, `message`
  - Previous format: flat array of strings
  - Migration: Update code expecting mobile_issues to handle new object structure

- **Enhanced**: `gsc_inspect_url` now includes rich results validation
  - Added `rich_result_types: string[]` - List of detected rich result types
  - Added `rich_result_items: RichResultItem[]` - Detailed items with type, name, and issues
  - Backward compatible: Legacy `rich_results_issues` field maintained

- **Enhanced**: Dual-mode URL monitoring in `gsc_monitor_urls`
  - Now supports direct URL array: `{ site: string, urls: string[] }` (max 50 URLs)
  - Config file mode still supported for larger batches
  - Both modes support dry-run preview

### Fixed

- Improved error handling in Go backend helper functions
  - `findConversionByEventName` now returns explicit errors instead of masking API failures
  - `findDimensionByParameterName` distinguishes between "not found" and API errors
  - Better error context for debugging

- Broadened authentication error detection
  - Added 5 new patterns: `authentication required`, `not authenticated`, `access token`, `oauth`, `service account`, `login required`
  - More reliable error identification and suggestions

- Fixed cleanup command flag documentation to include "metrics" option
- Added `MEASUREMENT_UNIT_UNSPECIFIED` validation for GA4 metrics
- Simplified redundant test conditionals
- Added language specifiers to all documentation code blocks for better syntax highlighting

### Technical

- All 721 MCP tests passing
- Go build successful with 0 lint issues
- CodeRabbitAI review: All 34 issues resolved (9 actionable + 25 documentation)

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
