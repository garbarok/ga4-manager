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
```

## Architecture

### CLI Structure (Cobra-based)
The application uses Cobra for CLI commands with the following hierarchy:
- **root.go**: Base command, checks for `GOOGLE_APPLICATION_CREDENTIALS`
- **setup.go**: Creates conversions, dimensions, and metrics via GA4 API
- **report.go**: Lists existing conversions, dimensions, and metrics
- **link.go**: Link external services (Search Console, BigQuery, Channel Groups)

### Key Components

**[internal/config/projects.go](internal/config/projects.go)**: Central configuration defining two projects:
- `SnapCompress` (Property ID: 513421535) - Image compression tool analytics
- `PersonalWebsite` (Property ID: 513885304) - Personal portfolio/blog analytics

Each project defines:
- Conversion events with counting methods (ONCE_PER_SESSION or ONCE_PER_EVENT)
- Custom dimensions with parameter names, display names, and scopes (USER or EVENT)
- Audience definitions (manual creation only, API cannot create audiences)

**[internal/ga4/](internal/ga4/)**: GA4 API wrapper
- [client.go](internal/ga4/client.go): Initializes Google Analytics Admin API service
- [conversions.go](internal/ga4/conversions.go): Creates and lists conversion events
- [dimensions.go](internal/ga4/dimensions.go): Creates and lists custom dimensions
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
