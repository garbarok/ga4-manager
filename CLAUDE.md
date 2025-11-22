# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GA4 Manager is a CLI tool for managing Google Analytics 4 properties, specifically designed for SnapCompress and Personal Website projects. It automates the creation of conversion events and custom dimensions using the Google Analytics Admin API.

## Development Commands

### Build and Run

```bash
# Build binary
make build           # Creates ./ga4 executable
go build -o ga4 .   # Alternative

# Run without building
make run ARGS='setup --all'
go run main.go setup --all

# Install globally
make install        # Installs to /usr/local/bin/ga4
```

### Testing

```bash
make test           # Run all tests
go test -v ./...   # Verbose test output
make lint           # Run golangci-lint
```

### Cleanup

```bash
make clean         # Remove build artifacts
```

### Linting

```bash
make lint           # Run linter (golangci-lint v2.6.2)
golangci-lint run   # Direct linter execution
```

### Project-Specific Commands

```bash
# Setup commands
make setup-all            # Setup both projects
make setup-snap           # SnapCompress only
make setup-personal       # Personal Website only

# Report commands
./ga4 report --all        # Show reports for all projects
./ga4 report -p snapcompress  # SnapCompress only
./ga4 report -p personal  # Personal Website only
make report-snap          # Show SnapCompress config (Makefile alias)
make report-personal      # Show Personal Website config (Makefile alias)

# Cleanup commands (remove unused events/dimensions)
./ga4 cleanup --project personal --dry-run  # Preview cleanup changes
./ga4 cleanup --project personal            # Remove unused items (with confirmation)
./ga4 cleanup -p personal --type conversions --yes  # Remove conversions only, skip confirmation
./ga4 cleanup --all --dry-run               # Preview cleanup for all projects
```

## Release Workflow

### Automated Binary Building

The project uses GitHub Actions to automatically build multi-platform binaries when a new release is created.

**Workflow file**: [.github/workflows/release.yml](.github/workflows/release.yml)

**Supported Platforms**:

- Linux (amd64, arm64)
- macOS (Intel amd64, Apple Silicon arm64)
- Windows (amd64)

### Creating a Release

#### Method 1: Using GitHub CLI (Recommended)

```bash
# Create a new release with auto-generated notes
gh release create v1.1.0 --generate-notes

# Or create with custom release notes
gh release create v1.1.0 --title "v1.1.0 - Feature Release" --notes "Release notes here"
```

#### Method 2: Git Tags

```bash
# Create and push a tag
git tag v1.1.0
git push origin v1.1.0

# The workflow will automatically trigger and:
# 1. Build binaries for all 5 platforms
# 2. Create compressed archives (.tar.gz for Unix, .zip for Windows)
# 3. Create the GitHub release
# 4. Attach all binaries to the release
```

#### Method 3: Manual Trigger

You can also trigger the workflow manually from the GitHub Actions tab.

### Release Artifacts

Each release automatically includes:

- `ga4-linux-amd64.tar.gz` - Linux x86_64
- `ga4-linux-arm64.tar.gz` - Linux ARM64
- `ga4-darwin-amd64.tar.gz` - macOS Intel
- `ga4-darwin-arm64.tar.gz` - macOS Apple Silicon
- `ga4-windows-amd64.zip` - Windows x86_64

### Version Information

The binary includes version information that can be queried:

```bash
# Check version
./ga4 --version
# Output: ga4 version v1.0.0
```

**Version Injection**:

- **Releases**: Version is set from the git tag (e.g., `v1.0.0`)
- **Local builds**: Version is set from `git describe` (e.g., `4c62d76-dirty`)
- **Version variable**: Located in [cmd/root.go](cmd/root.go) and set via ldflags during build

**Build flags** (see [Makefile](Makefile)):

```makefile
LDFLAGS=-ldflags "-s -w -X 'github.com/garbarok/ga4-manager/cmd.Version=$(VERSION)'"
```

### Release Checklist

When creating a new release:

1. **Update version-specific code** (if needed)

   - Update CLAUDE.md with any new features or changes
   - Update any documentation

2. **Test locally**

   ```bash
   make build
   make test
   make lint
   ```

3. **Create and push the release**

   ```bash
   gh release create v1.x.x --generate-notes
   ```

4. **Verify the workflow**

   ```bash
   # Check workflow status
   gh run list --workflow=release.yml --limit 1

   # View release details
   gh release view v1.x.x

   # List attached assets
   gh release view v1.x.x --json assets --jq '.assets[] | .name'
   ```

5. **Test a downloaded binary**
   ```bash
   # Download and test
   gh release download v1.x.x -p '*darwin-arm64*'
   tar -xzf ga4-darwin-arm64.tar.gz
   ./ga4-darwin-arm64 --version
   ```

### Deleting a Release

If you need to delete a release and retry:

```bash
# Delete release and tag
gh release delete v1.x.x --yes
git push origin :refs/tags/v1.x.x

# Create new release
gh release create v1.x.x --generate-notes
```

### Workflow Details

The release workflow consists of two jobs:

1. **Build Job** (Matrix strategy for 5 platforms)

   - Builds binary with version injection
   - Runs in parallel for all platforms
   - Uploads artifacts for the release job

2. **Release Job** (Depends on build)
   - Downloads all artifacts
   - Creates compressed archives
   - Creates/updates GitHub release
   - Attaches all binaries to the release

**Key Features**:

- ✅ Parallel builds for faster release creation (~1 minute total)
- ✅ Automatic version injection from git tags
- ✅ Auto-generated release notes from commits
- ✅ Compressed binaries to reduce download size
- ✅ Triggered automatically on tag push
- ✅ Can be manually triggered via workflow_dispatch

## Architecture

### CLI Structure (Cobra-based)

The application uses Cobra for CLI commands with the following hierarchy:

- **root.go**: Base command, checks for `GOOGLE_APPLICATION_CREDENTIALS`
- **setup.go**: Creates conversions, dimensions, and metrics via GA4 API
- **report.go**: Lists existing conversions, dimensions, and metrics
- **link.go**: Link external services (Search Console, BigQuery, Channel Groups)
- **cleanup.go**: Removes unused conversions and dimensions from GA4

### Key Components

**[internal/config/projects.go](internal/config/projects.go)**: Central configuration defining two projects:

- `SnapCompress` (Property ID: 513421535) - Image compression tool analytics
- `PersonalWebsite` (Property ID: 513885304) - Personal portfolio/blog analytics

Each project defines:

- Conversion events with counting methods (ONCE_PER_SESSION or ONCE_PER_EVENT)
- Custom dimensions with parameter names, display names, and scopes (USER or EVENT)
- Audience definitions (manual creation only, API cannot create audiences)
- Cleanup configuration: Lists of events and dimensions to remove (not implemented in tracking code)

**[internal/ga4/](internal/ga4/)**: GA4 API wrapper

- [client.go](internal/ga4/client.go): Initializes Google Analytics Admin API service
- [conversions.go](internal/ga4/conversions.go): Creates, lists, and deletes conversion events
- [dimensions.go](internal/ga4/dimensions.go): Creates, lists, and archives custom dimensions
- [metrics.go](internal/ga4/metrics.go): Creates and manages custom metrics
- [calculated.go](internal/ga4/calculated.go): Manages calculated metrics
- [audiences.go](internal/ga4/audiences.go): Generates audience setup documentation
- [datastreams.go](internal/ga4/datastreams.go): Manages data streams and enhanced measurement
- [retention.go](internal/ga4/retention.go): Configures data retention settings
- [searchconsole.go](internal/ga4/searchconsole.go): Generates Search Console setup guides
- [bigquery.go](internal/ga4/bigquery.go): Manages BigQuery export links (list only, manual creation)
- [channels.go](internal/ga4/channels.go): Creates and manages custom channel groups

All GA4 operations require:

- Property ID format: `properties/{propertyID}`
- Data stream path: `properties/{propertyID}/dataStreams/XXXXX` (retrieved dynamically)

### Data Flow

1. User runs command (`./ga4 setup --project snapcompress`)
2. Command handler ([cmd/setup.go](cmd/setup.go)) retrieves project config from [internal/config/projects.go](internal/config/projects.go)
3. GA4 client initializes with credentials from `GOOGLE_APPLICATION_CREDENTIALS`
4. Client makes API calls to Google Analytics Admin API v1alpha
5. Results displayed with colored output (success/error/info)

## Production-Ready Features

GA4 Manager includes enterprise-grade production features designed for reliability, performance, and observability.

### Rate Limiting

**Purpose**: Prevent exceeding Google Analytics Admin API quotas (50 requests/project/second default).

**Implementation**: Uses `golang.org/x/time/rate` token bucket algorithm.

**Configuration** ([internal/config/client.go](internal/config/client.go)):

```go
// Default configuration (10 RPS, burst of 20)
config.DefaultClientConfig()

// Production configuration (5 RPS, burst of 10)
config.ProductionClientConfig()

// Development configuration (10 RPS, burst of 30)
config.DevelopmentClientConfig()
```

**How it works**:

- Every API call waits for rate limiter permission before executing
- Prevents quota exhaustion and API throttling
- Configurable per-second rate and burst capacity
- Automatic backpressure handling with context timeouts

**Files modified**:

- `internal/ga4/client.go`: Rate limiter initialization and `waitForRateLimit()` method
- `internal/ga4/conversions.go`, `dimensions.go`, `metrics.go`: Rate limiting on all API calls

### Structured Logging

**Purpose**: Production-grade observability with log/slog (Go 1.21+ standard library).

**Features**:

- Structured logs with key-value pairs
- Multiple log levels: debug, info, warn, error
- JSON and text output formats
- Source code location tracking (optional)
- Context-aware logging with property IDs, event names, etc.

**Configuration**:

```go
// Text format for development (human-readable)
LoggingConfig{
    Level:     "debug",
    Format:    "text",
    AddSource: true,
}

// JSON format for production (machine-parseable)
LoggingConfig{
    Level:     "warn",
    Format:    "json",
    AddSource: true,
}
```

**Example log output**:

```text
time=2024-11-22T10:30:45.123Z level=INFO msg="conversion created successfully" event_name=download_image property_id=513421535
time=2024-11-22T10:30:46.456Z level=ERROR msg="invalid property ID" property_id=abc123 error="property ID must be numeric"
```

**Files modified**:

- `internal/ga4/client.go`: Logger initialization and configuration
- All `internal/ga4/*.go` files: Structured logging at debug, info, warn, and error levels

### Input Validation

**Purpose**: Validate all inputs before making API calls to provide better error messages and prevent invalid API requests.

**Validation Package** ([internal/validation/validation.go](internal/validation/validation.go)):

```go
// Validates property IDs (numeric, positive)
ValidatePropertyID(propertyID string) error

// Validates event names (starts with letter, alphanumeric + underscore, max 40 chars)
ValidateEventName(eventName string) error

// Validates parameter names (same rules as event names)
ValidateParameterName(paramName string) error

// Validates display names (max 82 characters)
ValidateDisplayName(displayName string) error

// Validates counting methods (ONCE_PER_EVENT or ONCE_PER_SESSION)
ValidateCountingMethod(method string) error

// Validates dimension/metric scopes (EVENT, USER, or ITEM)
ValidateScope(scope string) error

// Validates measurement units (STANDARD, CURRENCY, SECONDS, etc.)
ValidateMeasurementUnit(unit string) error
```

**Reserved Prefix Detection**:

- Prevents using GA4 reserved prefixes: `google_`, `ga_`, `firebase_`
- Returns descriptive error messages with context

**Example validation errors**:

```
validation failed: invalid event name format: 2download (must start with letter, contain only alphanumeric and underscore)
validation failed: event name cannot start with reserved prefix 'google_': google_conversion
validation failed: property ID: abc123 (must be numeric)
```

**Files modified**:

- `internal/validation/validation.go`: All validation functions
- `internal/validation/validation_test.go`: Comprehensive test suite
- All `internal/ga4/*.go` files: Input validation before API calls

### Timeout Configuration

**Purpose**: Prevent indefinite hangs and control request/context lifetimes.

**Configuration** ([internal/config/client.go](internal/config/client.go)):

```go
TimeoutConfig{
    RequestTimeout: 30 * time.Second,  // Per-request timeout
    ContextTimeout: 5 * time.Minute,   // Overall client timeout
}
```

**How it works**:

- `ContextTimeout`: Overall client context lifetime (default: 5 minutes)
- `RequestTimeout`: Individual API request timeout (default: 30 seconds)
- Rate limiter waits respect request timeout
- Prevents resource leaks and hanging operations

**Files modified**:

- `internal/ga4/client.go`: Context creation with timeout, request-level timeouts in `waitForRateLimit()`

### Dry-Run Mode

**Purpose**: Preview changes without applying them, crucial for production environments.

**Available Commands**:

```bash
# Preview setup without making changes
./ga4 setup --project personal --dry-run

# Preview cleanup without deleting anything
./ga4 cleanup --project personal --dry-run
```

**Dry-run output**:

- Shows exactly what would be created/deleted
- Includes all configuration details (parameters, scopes, counting methods)
- Clear visual distinction (blue ○ symbols vs. green ✓ or red ✗)
- No API calls made, no quota consumed

**Example output**:

```
ℹ️  Dry-run mode enabled - no changes will be applied

🎯 Creating conversions...
  ○ download_image (counting: ONCE_PER_EVENT)
  ○ compression_complete (counting: ONCE_PER_SESSION)

📊 Creating custom dimensions...
  ○ User Type (param: user_type, scope: USER)
  ○ Compression Quality (param: compression_quality, scope: EVENT)

ℹ️  Dry-run complete! No changes were applied.
```

**Files modified**:

- `cmd/setup.go`: Added `--dry-run` flag and conditional logic
- `cmd/cleanup.go`: Already had dry-run support (enhanced with new features)

### Configuration Profiles

**Purpose**: Different settings for development, production, and testing environments.

**Available Profiles** ([internal/config/client.go](internal/config/client.go)):

**Default Configuration** (balanced for CLI usage):

```go
config.DefaultClientConfig()
// Rate: 10 RPS, burst 20
// Timeout: 30s request, 5min context
// Logging: info level, text format
```

**Production Configuration** (conservative, reliable):

```go
config.ProductionClientConfig()
// Rate: 5 RPS, burst 10 (more conservative)
// Timeout: 30s request, 10min context
// Logging: warn level, JSON format, includes source
```

**Development Configuration** (verbose, faster):

```go
config.DevelopmentClientConfig()
// Rate: 10 RPS, burst 30 (higher burst)
// Timeout: 60s request, 15min context (longer for debugging)
// Logging: debug level, text format, includes source
```

**Usage**:

```go
// Use production configuration
client, err := ga4.NewClient(ga4.WithConfig(config.ProductionClientConfig()))

// Use custom configuration
cfg := config.DefaultClientConfig()
cfg.RateLimiting.RequestsPerSecond = 15.0
client, err := ga4.NewClient(ga4.WithConfig(cfg))
```

### Error Context Enhancement

**Purpose**: Rich error messages with full context for debugging.

**Before** (v1.0.0):

```
failed to create conversion
```

**After** (v1.2.0):

```
validation failed: invalid event name format: 2download (must start with letter, contain only alphanumeric and underscore)
failed to create conversion 'download_image' for property 513421535: API error: already exists
rate limit wait failed for CreateConversion: context deadline exceeded
```

**Error wrapping**:

- Uses Go 1.13+ error wrapping (`%w` format)
- Preserves error chain for debugging
- Includes operation name, property ID, resource names
- Structured logging captures error context

**Files modified**:

- All `internal/ga4/*.go` files: Enhanced error messages with context

### Testing

**Validation Tests** ([internal/validation/validation_test.go](internal/validation/validation_test.go)):

- Comprehensive table-driven tests
- Tests for valid and invalid inputs
- Edge case coverage (empty strings, max lengths, reserved prefixes)
- 100% code coverage for validation package

**Run tests**:

```bash
go test ./internal/validation/...
go test -v ./internal/validation/...  # Verbose output
go test -cover ./internal/validation/...  # With coverage
```

## Environment Requirements

The application loads environment variables from a `.env` file in the project root using [github.com/joho/godotenv](https://github.com/joho/godotenv).

### Setup

1. Copy `.env.example` to `.env`
2. Fill in your credentials:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   ```

The `.env` file is loaded automatically in [cmd/root.go](cmd/root.go) init function before any commands execute.

### Required OAuth Scopes

- `https://www.googleapis.com/auth/analytics.edit`
- `https://www.googleapis.com/auth/analytics.readonly`

## Project-Specific Details

### SnapCompress Analytics

- **Conversions**: `download_image`, `compression_complete`, `format_conversion`, `blog_engagement`
- **Dimensions**: User Type, Compression Quality, File Format, Compression Ratio, Download Method
- Tracks image compression workflows and user behavior

### Personal Website Analytics

- **Conversions**: `newsletter_subscribe`, `contact_form_submit`, `demo_click`, `github_click`, `article_read`, `code_copy`
- **Dimensions**: Article Category, Content Language, Reader Type, Word Count, Reading Completion
- Tracks content engagement and reader interactions

## Cleanup Feature

The cleanup command helps maintain a clean GA4 configuration by removing events, dimensions, and metrics that are not actively tracked in your codebase.

### Configuration

Each project in `internal/config/projects.go` includes a `Cleanup` section that specifies:

- **ConversionsToRemove**: List of event names to delete (not implemented in tracking code)
- **DimensionsToRemove**: List of parameter names to archive (not being tracked)
- **MetricsToRemove**: List of metric parameter names to archive (not being tracked) - **NEW in v1.1.0**
- **Reason**: Explanation of why these items should be removed

### Usage Examples

```bash
# Preview what will be removed (recommended first step)
./ga4 cleanup --project personal --dry-run

# Remove unused conversions only
./ga4 cleanup --project personal --type conversions

# Remove unused dimensions only
./ga4 cleanup --project personal --type dimensions

# Remove unused metrics only (NEW in v1.1.0)
./ga4 cleanup --project personal --type metrics

# Remove everything: conversions, dimensions, AND metrics
./ga4 cleanup --project personal --type all

# Skip confirmation prompt
./ga4 cleanup --project personal --yes

# Cleanup from YAML configuration file
./ga4 cleanup --config configs/my-project.yaml --dry-run
```

### Personal Website Cleanup

Based on actual implementation in `blog-analytics.ts`, the following items are configured for removal:

**Events to Remove (15)**:

- `newsletter_subscribe`, `demo_click`, `organic_article_visit`, `featured_snippet_view`
- `search_impression`, `resource_load_error`, `backlink_click`, `404_error`
- `core_web_vitals_fail`, `core_web_vitals_pass`, `page_speed_good`
- `article_bookmark`, `comment_submitted`, `internal_search`, `related_content_engagement`

**Dimensions to Remove (33)**: All Core Web Vitals, SEO, User Engagement, and Technical SEO dimensions not actively tracked

**Events to Keep (9)**:

- `article_read`, `read_time_exceeded`, `toc_interaction`
- `article_share_twitter`, `article_share_linkedin`, `related_article_click`
- `code_copy`, `contact_form_submit`, `github_click`

### Benefits

- ✅ Reduce noise in GA4 reports
- ✅ Improve data quality and focus
- ✅ Free up GA4 property quota (25 conversions, 50 custom dimensions, 50 custom metrics limits)
- ✅ Make reporting more focused and actionable
- ✅ Preserve historical data (items are archived, not permanently deleted)

### Important Limitations

**Archived Dimensions & Metrics**: When you archive a custom dimension or metric in GA4, the **parameter name is permanently reserved** and cannot be reused, even if you delete/archive the item. This is a GA4 platform limitation, not a tool limitation.

**Workarounds**:

1. **Un-archive in GA4 UI**: Go to Admin → Custom Definitions, filter by "Archived", and manually restore items
2. **Use different parameter names**: If you need to recreate a dimension/metric, use a new parameter name (e.g., `user_type_v2` instead of `user_type`)

**Best Practice**: Before running cleanup, ensure you truly want to remove these items permanently, as you cannot reuse those parameter names without manual intervention in the GA4 UI.

### API Status & Limitations

- **Audiences**: Cannot be created via the API due to complex filter logic requirements. They must be configured manually in the GA4 UI. The tool provides comprehensive documentation on which audiences to create.
- **Search Console Links**: The GA4 Admin API does **not** support programmatic creation of Search Console links. The `link` command generates comprehensive manual setup guides with step-by-step instructions.
- **BigQuery Links**: **Partially supported.** The API can list and retrieve existing BigQuery links but cannot create or delete them. The tool generates detailed setup guides for manual configuration.
- **Channel Groups**: **Fully supported (Fixed 2025-11-22).** All API compatibility issues have been resolved. The tool can now create, list, update, and delete custom channel groups programmatically.

## Dependencies

- **github.com/spf13/cobra**: CLI framework
- **google.golang.org/api/analyticsadmin/v1alpha**: GA4 Admin API client
- **github.com/fatih/color**: Terminal color output
- **github.com/olekukonko/tablewriter**: Report table formatting

## Recent Updates (2025-11-22)

### Release Automation & Versioning

- Created GitHub Actions release workflow ([.github/workflows/release.yml](.github/workflows/release.yml))
- Automated multi-platform binary building (Linux, macOS, Windows)
- Added version support via ldflags injection
- Binary now supports `--version` flag
- Release workflow builds 5 platform variants in ~1 minute
- **Status**: Fully functional - v1.0.0 released successfully

### Code Quality & Linting

- Installed and configured `golangci-lint` v2.6.2
- Created `.golangci.yml` configuration file
- Added `make lint` command to Makefile
- **Status**: All lint errors fixed - 0 issues

### API Compatibility Fixes

#### BigQuery Integration ([internal/ga4/bigquery.go](internal/ga4/bigquery.go))

- **Fixed**: Removed non-existent `Dataset` field from `BigQueryLink` struct
- **Fixed**: Updated `CreateBigQueryLink()` and `DeleteBigQueryLink()` to return informative errors directing users to manual setup
- **Fixed**: Removed `Dataset` field from `GetBigQueryExportStatus()`
- **Status**: API limitation acknowledged, manual setup guides provided

#### Channel Groups Integration ([internal/ga4/channels.go](internal/ga4/channels.go))

- **Fixed**: `GoogleAnalyticsAdminV1alphaInListFilter` → `GoogleAnalyticsAdminV1alphaChannelGroupFilterInListFilter`
- **Fixed**: `GoogleAnalyticsAdminV1alphaStringFilter` → `GoogleAnalyticsAdminV1alphaChannelGroupFilterStringFilter`
- **Fixed**: `Expressions` → `FilterExpressions` in `ChannelGroupFilterExpressionList`
- **Status**: Fully functional, can create/list/update/delete channel groups

#### Link Command ([cmd/link.go](cmd/link.go))

- **Fixed**: Replaced non-existent `config.GetProject()` with proper switch statement for project selection
- **Fixed**: All unchecked error returns from color print functions (added `_, _` receivers)
- **Fixed**: Removed Dataset field references
- **Fixed**: Boolean comparison simplification (`group.SystemDefined == true` → `group.SystemDefined`)
- **Status**: Fully functional with proper error handling

#### Other Fixes

- **Fixed**: Unnecessary `fmt.Sprintf` usage in [internal/ga4/datastreams.go](internal/ga4/datastreams.go:209)
- **Fixed**: Capitalized error strings in [internal/ga4/searchconsole.go](internal/ga4/searchconsole.go:24)

### Build & Test Status

- ✅ **Build**: Successful (20MB binary)
- ✅ **Lint**: 0 issues
- ✅ **Commands**: All validated and working
  - `./ga4 setup` - Creates conversions, dimensions, metrics
  - `./ga4 report` - Shows configuration reports
  - `./ga4 link` - Manages external service integrations
  - `./ga4 cleanup` - Removes unused events, dimensions, and metrics

## Recent Updates (2025-11-22) - v1.1.0

### NEW FEATURE: Custom Metrics Cleanup 🎉

Extended the cleanup command to support archiving custom metrics in addition to conversions and dimensions.

**Files Modified:**

- **[internal/ga4/metrics.go](internal/ga4/metrics.go)**:

  - Added `DeleteMetric(propertyID, parameterName)` function
  - Finds metrics by parameter name and archives them via GA4 API

- **[internal/config/projects.go](internal/config/projects.go)**:

  - Added `MetricsToRemove []string` field to `CleanupConfig` struct

- **[internal/config/types.go](internal/config/types.go)**:

  - Added `MetricsToRemove` field to `CleanupYAMLConfig`
  - Updated `ConvertToLegacyProject()` to include metrics cleanup

- **[cmd/cleanup.go](cmd/cleanup.go)**:

  - Extended `--type` flag to accept `metrics` value
  - Added metrics display table and cleanup logic
  - Updated command help text and examples

- **[internal/ga4/dimensions.go](internal/ga4/dimensions.go)**:
  - Added `PageSize(200)` to `ListDimensions()` to ensure all dimensions are retrieved

**New Usage:**

```bash
# Remove only custom metrics
./ga4 cleanup --project snapcompress --type metrics

# Remove everything (conversions, dimensions, AND metrics)
./ga4 cleanup --project snapcompress --type all
```

**Impact:**

- Provides complete GA4 property cleanup capability
- Addresses GA4 Standard tier limits (50 metrics maximum)
- Complements existing cleanup for conversions and dimensions
- **Status**: Fully tested and functional
