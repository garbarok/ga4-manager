# GA4 Manager CLI

A simple CLI tool to manage Google Analytics 4 properties for SnapCompress and Personal Website projects.

## Features

- 🎯 Automated conversion events setup
- 📊 Custom dimensions management
- 📈 Custom metrics creation
- 👥 Enhanced audience definitions
- 🔗 External service integration guides (Search Console, BigQuery)
- 📡 Channel grouping configuration
- 📋 Quick configuration reports
- 🚀 Simple and fast

## Installation

```bash
# Clone and build
cd ~/projects/ga4-manager
go mod download
go build -o ga4 .

# Or use make
make build
```

## Prerequisites

1. **Environment Setup**

   Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your credentials:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   ```

2. **Required OAuth Scopes**
   - `https://www.googleapis.com/auth/analytics.edit`
   - `https://www.googleapis.com/auth/analytics.readonly`

## Usage

### Setup all GA4 configuration

```bash
# Setup both projects
./ga4 setup --all

# Setup specific project
./ga4 setup --project snapcompress
./ga4 setup --project personal
```

### View current configuration

```bash
# Show SnapCompress config
./ga4 report

# Show Personal Website config
./ga4 report --project personal
```

### Link external services

```bash
# List existing links
./ga4 link --project snapcompress --list

# Setup Search Console (generates manual setup guide)
./ga4 link --project snapcompress --service search-console --url https://snapcompress.com

# Setup BigQuery export (generates manual setup guide)
./ga4 link --project snapcompress --service bigquery --gcp-project my-project --dataset analytics_data

# Setup channel groupings
./ga4 link --project snapcompress --service channels
```

### Help

```bash
./ga4 --help
./ga4 setup --help
./ga4 report --help
./ga4 link --help
```

## What it automates

### SnapCompress
- **Conversions**: `download_image`, `compression_complete`, `format_conversion`, `blog_engagement`
- **Custom Dimensions**: User Type, Compression Quality, File Format, Compression Ratio, Download Method

### Personal Website  
- **Conversions**: `newsletter_subscribe`, `contact_form_submit`, `demo_click`, `github_click`, `article_read`, `code_copy`
- **Custom Dimensions**: Article Category, Content Language, Reader Type, Word Count, Reading Completion

## Examples

```bash
# Initial setup for all projects
./ga4 setup --all

# Check what's configured
./ga4 report --project snapcompress
./ga4 report --project personal

# Setup only SnapCompress
./ga4 setup -p snap
```

## Note on Audiences

Audiences cannot be created via API due to their complex filter logic. They must be created manually in the GA4 UI. The tool will list which audiences should be created for each project.

## Development

```bash
# Run without building
go run main.go setup --all

# Build
make build

# Install globally
make install
```

## Project Structure

```
ga4-manager/
├── cmd/              # CLI commands
│   ├── root.go      # Root command
│   ├── setup.go     # Setup command
│   └── report.go    # Report command
├── internal/
│   ├── ga4/         # GA4 API client
│   └── config/      # Project configurations
├── main.go
└── go.mod
```

## License

Personal use only.
