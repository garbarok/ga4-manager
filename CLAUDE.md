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
```

### Cleanup
```bash
make clean         # Remove build artifacts
```

### Project-Specific Commands
```bash
# Setup commands
make setup-all            # Setup both projects
make setup-snap           # SnapCompress only
make setup-personal       # Personal Website only

# Report commands
make report-snap          # Show SnapCompress config
make report-personal      # Show Personal Website config
```

## Architecture

### CLI Structure (Cobra-based)
The application uses Cobra for CLI commands with the following hierarchy:
- **root.go**: Base command, checks for `GOOGLE_APPLICATION_CREDENTIALS`
- **setup.go**: Creates conversions and dimensions via GA4 API
- **report.go**: Lists existing conversions and dimensions

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

- **Audiences**: Cannot be created via the API due to complex filter logic requirements. They must be configured manually in the GA4 UI. The tool provides guidance on which audiences to create.
- **Search Console Links**: The GA4 Admin API does **not** support programmatic creation of Search Console links. The `link` command for this service generates a comprehensive manual setup guide.
- **BigQuery Links**: **Fully supported.** The tool can create, list, and delete BigQuery export links programmatically.
- **Channel Groups**: **Fully supported.** Previous 500 errors were due to an implementation bug, which has been fixed. The tool can now create, list, and delete custom channel groups.

## Dependencies

- **github.com/spf13/cobra**: CLI framework
- **google.golang.org/api/analyticsadmin/v1alpha**: GA4 Admin API client
- **github.com/fatih/color**: Terminal color output
- **github.com/olekukonko/tablewriter**: Report table formatting
