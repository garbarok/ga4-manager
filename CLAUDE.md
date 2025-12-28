# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GA4 Manager is a CLI tool for managing Google Analytics 4 properties. It automates the creation of conversion events, custom dimensions, and metrics using the Google Analytics Admin API.

**MCP Server**: Exposes all CLI commands as structured tools for Claude Desktop, Claude CLI, VS Code, Cursor, and Cline. See [`mcp/README.md`](mcp/README.md) for complete documentation.

## Quick Start

```bash
# Build and run
make build                    # Creates ./ga4 executable
./ga4 setup --all             # Setup all projects
./ga4 report --all            # Show reports

# Common workflows
./ga4 cleanup --config configs/my-project.yaml --dry-run   # Preview cleanup
./ga4 link channels --config configs/my-project.yaml       # Link external services
make test && make lint                                     # Run tests and linting
```

## Development Commands

### Build & Test

```bash
make build          # Build binary
make install        # Install to /usr/local/bin/ga4
make test           # Run all tests
make lint           # Run golangci-lint
make clean          # Remove build artifacts
```

### Project Commands

```bash
# Setup
./ga4 setup --config configs/my-project.yaml
./ga4 setup --all  # Setup all projects in configs/

# Reports
./ga4 report --config configs/my-project.yaml
./ga4 report --all  # Show reports for all projects

# Cleanup (remove unused events/dimensions/metrics)
./ga4 cleanup --config configs/my-project.yaml [--type conversions|dimensions|metrics|all] [--dry-run] [--yes]
```

### MCP Server

```bash
cd mcp
npm install && npm run build
npm test              # 720+ tests
npm run dev           # Development mode
```

**Setup**: See [`mcp/CONFIGURATION.md`](mcp/CONFIGURATION.md) for multi-client setup.

**Available Tools** (13): `ga4_setup`, `ga4_report`, `ga4_cleanup`, `ga4_link`, `ga4_validate`, `gsc_sitemaps_*`, `gsc_inspect_url`, `gsc_analytics_run`, `gsc_monitor_urls`, `gsc_index_coverage`

## Release Workflow

Create releases using GitHub CLI (triggers automated multi-platform builds):

```bash
# Create release
gh release create v1.x.x --generate-notes

# Verify
gh run list --workflow=release.yml --limit 1

# Delete and retry if needed
gh release delete v1.x.x --yes && git push origin :refs/tags/v1.x.x
```

**Platforms**: Linux (amd64, arm64), macOS (Intel, Apple Silicon), Windows (amd64)

**Version injection**: Binary includes version from git tags (see [.github/workflows/release.yml](.github/workflows/release.yml))

**Release Checklist**:
1. Update docs if needed
2. `make build && make test && make lint`
3. `gh release create v1.x.x --generate-notes`
4. Verify workflow completion

## Architecture

### CLI Structure (Cobra)

- **root.go**: Base command, environment validation
- **setup.go**: Creates conversions, dimensions, metrics
- **report.go**: Lists existing configuration
- **link.go**: External services (Search Console, BigQuery, Channels)
- **cleanup.go**: Removes unused items

### Key Components

**[internal/config/projects.go](internal/config/projects.go)**: Project configuration types and structures

**[internal/ga4/](internal/ga4/)**: GA4 API wrapper
- client.go, conversions.go, dimensions.go, metrics.go
- calculated.go, audiences.go, datastreams.go, retention.go
- searchconsole.go, bigquery.go, channels.go

**[internal/gsc/](internal/gsc/)**: Google Search Console integration
- coverage.go, inspection.go, sitemaps.go, analytics.go

**Data Flow**: Command → Config → GA4 Client → API → Colored output

## Production Features

All implemented in `internal/config/client.go` and `internal/ga4/*.go`:

**Rate Limiting**
- Token bucket algorithm (default: 10 RPS, burst 20)
- Configurable profiles: Default, Production, Development
- Prevents quota exhaustion

**Structured Logging**
- log/slog (Go 1.21+) with JSON/text formats
- Levels: debug, info, warn, error
- Context-aware with property IDs, event names

**Input Validation** (`internal/validation/validation.go`)
- Property IDs, event names, parameter names, scopes
- Reserved prefix detection (`google_`, `ga_`, `firebase_`)
- Descriptive error messages

**Timeout Configuration**
- Request timeout: 30s
- Context timeout: 5min
- Prevents hangs and resource leaks

**Dry-Run Mode**
- Preview changes without API calls
- Available in `setup` and `cleanup` commands
- No quota consumed

**Configuration Profiles**
```go
config.DefaultClientConfig()      // 10 RPS, 30s timeout
config.ProductionClientConfig()   // 5 RPS, 10min timeout, JSON logs
config.DevelopmentClientConfig()  // 10 RPS, 60s timeout, debug logs
```

**Error Context**
- Go 1.13+ error wrapping
- Full context: operation, property ID, resource names

See implementation files for details.

## Environment Setup

1. Copy `.env.example` to `.env`
2. Configure:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   ```

**Required OAuth Scopes**:
- `https://www.googleapis.com/auth/analytics.edit`
- `https://www.googleapis.com/auth/analytics.readonly`

## Cleanup Feature

Removes unused events, dimensions, and metrics from GA4 properties.

### Configuration

Each project defines cleanup specs in `internal/config/projects.go`:
- `ConversionsToRemove`: Event names to delete
- `DimensionsToRemove`: Parameter names to archive
- `MetricsToRemove`: Metric parameter names to archive

### Usage

```bash
./ga4 cleanup --config configs/my-project.yaml --dry-run                    # Preview
./ga4 cleanup --config configs/my-project.yaml --type conversions           # Specific type
./ga4 cleanup --config configs/my-project.yaml --type all --yes             # All, no confirm
```

### Important Limitations

**Archived items**: Parameter names are **permanently reserved** in GA4 (platform limitation).

**Workarounds**:
1. Un-archive in GA4 UI (Admin → Custom Definitions → Archived)
2. Use new parameter names (e.g., `user_type_v2`)

### API Limitations

- **Audiences**: Manual creation only (complex filter logic)
- **Search Console Links**: Manual setup (API unsupported)
- **BigQuery Links**: List/retrieve only (manual creation)
- **Channel Groups**: ✅ Fully supported (create/list/update/delete)

## Dependencies

- **github.com/spf13/cobra**: CLI framework
- **google.golang.org/api/analyticsadmin/v1alpha**: GA4 Admin API
- **github.com/fatih/color**: Terminal colors
- **github.com/olekukonko/tablewriter**: Report formatting
- **golang.org/x/time/rate**: Rate limiting
- **@modelcontextprotocol/sdk**: MCP server (TypeScript)

## Version History

**v2.0.0** (2025-12-28)
- Added `gsc_index_coverage` tool
- Enhanced mobile usability error parsing
- Enhanced rich results validation in `gsc_inspect_url`
- Batch URL monitoring improvements

**v1.1.0** (2025-11-22)
- Custom metrics cleanup support
- Extended `--type` flag for metrics

**v1.0.0** (2025-11-22)
- GitHub Actions automation
- Multi-platform binary building
- Full GA4 Admin API coverage
- MCP server with 12 tools
- Production features: rate limiting, logging, validation
- API compatibility fixes (BigQuery, Channel Groups)

See [mcp/CHANGELOG.md](mcp/CHANGELOG.md) for detailed release notes.

## Testing

```bash
# Go tests
go test ./...
go test -v ./internal/validation/...

# MCP tests (720+ passing)
cd mcp && npm test
```

**Build Status**:
- ✅ Binary: 20MB
- ✅ Lint: 0 issues (golangci-lint v2.6.2)
- ✅ All commands validated
