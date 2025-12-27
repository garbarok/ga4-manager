# GA4 Manager

> Production-ready CLI for managing Google Analytics 4 properties

A comprehensive command-line tool for automating GA4 configuration, including conversion events, custom dimensions, custom metrics, and external service integrations.

[![Test Status](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml)
[![Security](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml)
[![Release](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml)
[![Go Report Card](https://goreportcard.com/badge/github.com/garbarok/ga4-manager)](https://goreportcard.com/report/github.com/garbarok/ga4-manager)
[![Latest Release](https://img.shields.io/github/v/release/garbarok/ga4-manager)](https://github.com/garbarok/ga4-manager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go)](https://go.dev/)

## Features

### Core Capabilities
- **🎯 Conversion Events** - Automate creation and management of GA4 conversion events
- **📊 Custom Dimensions** - Define and deploy custom dimensions with proper scoping (USER/EVENT)
- **📈 Custom Metrics** - Create custom metrics with measurement units (CURRENCY, SECONDS, STANDARD, etc.)
- **🧹 Cleanup Management** - Remove unused events, dimensions, and metrics to free up quota
- **🔗 External Integrations** - Setup guides for Search Console, BigQuery, and Channel Groups
- **✅ Validation** - Validate YAML configuration files before deployment

### Google Search Console Integration (Phase 4)
- **🗺️ Sitemap Management** - Automated sitemap submission and verification
- **🔍 URL Inspection** - Inspect URLs for indexing status and issues
- **📊 Search Analytics** - Query search performance data (impressions, clicks, CTR, position)
- **⚡ Unified Setup** - Single command configures both GA4 and GSC from one YAML file

### Production-Ready Features
- **🛡️ Pre-flight Validation** - Comprehensive checks before any API calls
  - Credential validation
  - Property access verification
  - Resource conflict detection
  - Quota availability checking
- **📈 Progress Tracking** - Real-time status with color-coded indicators
- **🔄 Rollback Mechanism** - Automatic rollback on setup failures
- **🏭 Enterprise Features**:
  - Rate limiting (10 RPS, configurable)
  - Structured logging (JSON/text with slog)
  - Input validation (GA4 naming rules, reserved prefixes)
  - Dry-run mode (preview changes without applying)
  - Configuration profiles (dev/prod/default)
  - Multi-project support

## MCP Server Integration

GA4 Manager includes a **Model Context Protocol (MCP) server** that exposes all CLI commands as structured tools for AI assistants and development environments.

### Supported Clients
- **Claude Desktop** - Native integration with Claude
- **Claude CLI** - Command-line Claude interface
- **VS Code** - Via MCP extension
- **Cursor** - AI-powered code editor
- **Cline** - VS Code extension

### Features
- ✅ **12 MCP Tools** - Complete CLI coverage (5 GA4 + 7 GSC tools)
- ✅ **Structured JSON** - Machine-readable responses for agents
- ✅ **593 Passing Tests** - Production-ready reliability
- ✅ **Smart Parsing** - Automatic format detection (JSON, tables, CSV, markdown)
- ✅ **Dry-Run Support** - Safe previews before applying changes
- ✅ **Quota Tracking** - Monitor GSC API usage

### Quick Setup (Claude CLI)

```bash
claude mcp add \
  --name ga4-manager \
  --transport stdio \
  --command "node" \
  --args "/absolute/path/to/ga4-manager/mcp/dist/index.js" \
  --env "GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json" \
  --env "GOOGLE_CLOUD_PROJECT=your-gcp-project-id" \
  --env "GA4_BINARY_PATH=/absolute/path/to/ga4-manager/ga4" \
  --env "GA4_DEFAULT_PROPERTY_ID=123456789"
```

### Documentation
- **[MCP Server README](mcp/README.md)** - Complete tool documentation
- **[Configuration Guide](mcp/CONFIGURATION.md)** - Multi-client setup
- **[Example Configs](mcp/examples/)** - Ready-to-use templates

## Installation

### Download Pre-built Binary

Download the latest release for your platform:

```bash
# macOS (Apple Silicon)
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-arm64.tar.gz | tar xz
sudo mv ga4-darwin-arm64 /usr/local/bin/ga4

# macOS (Intel)
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-amd64.tar.gz | tar xz
sudo mv ga4-darwin-amd64 /usr/local/bin/ga4

# Linux (x86_64)
curl -L https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-linux-amd64.tar.gz | tar xz
sudo mv ga4-linux-amd64 /usr/local/bin/ga4
```

### Build from Source

```bash
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager
make build
sudo make install
```

For detailed installation instructions, see [INSTALL.md](INSTALL.md).

## Quick Start

### 1. Setup Google Cloud Credentials

```bash
# Set environment variables
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
```

See [INSTALL.md](INSTALL.md) for detailed credential setup.

### 2. Create Configuration File

```bash
# Copy an example template
cp configs/examples/basic-ecommerce.yaml configs/my-store.yaml

# Edit with your GA4 property ID
vim configs/my-store.yaml
```

### 3. Validate Configuration

```bash
ga4 validate configs/my-store.yaml
```

### 4. Preview Changes (Dry Run)

```bash
ga4 setup --config configs/my-store.yaml --dry-run
```

### 5. Apply Configuration

```bash
ga4 setup --config configs/my-store.yaml
```

## Unified Setup Workflow (Phase 4)

GA4 Manager now provides a single command to configure both Google Analytics 4 and Google Search Console:

```bash
# Single command for complete site instrumentation
ga4 setup --config configs/mysite.yaml
```

**What happens during setup:**

1. **Pre-flight Validation** ✅
   - Verifies credentials and permissions
   - Validates configuration schema
   - Checks resource availability
   - Detects conflicts with existing resources

2. **GA4 Setup** (if configured)
   - Creates conversion events
   - Creates custom dimensions
   - Creates custom metrics
   - Skips duplicates automatically

3. **Google Search Console Setup** (if configured)
   - Submits sitemaps for indexing
   - Configures URL monitoring
   - Enables search analytics

4. **Progress Tracking**
   - Real-time status updates
   - Color-coded indicators
   - Duration tracking

5. **Rollback on Error**
   - Automatic cleanup if setup fails
   - User confirmation prompt
   - Clean state guaranteed

**Example Output:**
```
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

✓ Pre-flight validation passed

[1/2] ◐ Google Analytics 4 Setup
  Creating conversions... (5/5 created)
  ✓ page_view
  ✓ contact_submit
  ○ newsletter_signup (already exists, skipping)

[2/2] ✓ Google Search Console Setup
  ✓ Submitted sitemap: https://mysite.com/sitemap.xml

Setup Summary:
  ✓ 2 steps completed
  Duration: 8.2 seconds

Next Steps:
  1. Verify in GA4: https://analytics.google.com
  2. Check Search Console: https://search.google.com/search-console
```

## Usage

### Setup Commands

```bash
# Setup from configuration file
ga4 setup --config configs/my-blog.yaml

# Preview setup without making changes
ga4 setup --config configs/my-blog.yaml --dry-run

# Setup all available configs
ga4 setup --all
```

### Report Commands

```bash
# View current GA4 configuration
ga4 report --config configs/my-store.yaml

# Report on all configured projects
ga4 report --all
```

### Cleanup Commands

```bash
# Preview cleanup (dry-run)
ga4 cleanup --config configs/my-blog.yaml --dry-run

# Remove unused conversions only
ga4 cleanup --config configs/my-blog.yaml --type conversions

# Remove unused dimensions only
ga4 cleanup --config configs/my-blog.yaml --type dimensions

# Remove unused metrics only
ga4 cleanup --config configs/my-blog.yaml --type metrics

# Remove everything (conversions, dimensions, and metrics)
ga4 cleanup --config configs/my-blog.yaml --type all
```

### Link Commands

```bash
# List existing external service links
ga4 link --project my-store --list

# Generate Search Console setup guide
ga4 link --project my-store --service search-console

# Setup custom channel groups
ga4 link --project my-store --service channels
```

### Validation

```bash
# Validate a specific config file
ga4 validate configs/my-project.yaml

# Validate all example configs
ga4 validate --all
```

## Configuration

GA4 Manager uses YAML configuration files to define your analytics setup. Example templates are provided in `configs/examples/`:

- **basic-ecommerce.yaml** - E-commerce store template
- **content-site.yaml** - Blog/content site template
- **template.yaml** - Minimal starter template

### Configuration Structure

```yaml
project:
  name: My Project
  description: Project description
  version: 1.0.0

# Google Analytics 4 Configuration (optional)
ga4:
  property_id: "123456789"  # Your GA4 property ID
  tier: standard             # standard or 360

conversions:
  - name: purchase
    counting_method: ONCE_PER_EVENT
    description: User completed purchase

dimensions:
  - parameter: user_type
    display_name: User Type
    description: Customer classification
    scope: USER

metrics:
  - parameter: cart_value
    display_name: Cart Value
    description: Cart total value
    unit: CURRENCY
    scope: EVENT

# Google Search Console Configuration (optional)
search_console:
  site_url: "https://example.com"  # Your verified site URL

sitemaps:
  - url: "https://example.com/sitemap.xml"
    priority: true

monitoring:
  priority_urls:
    - url: "https://example.com/"
      label: "Homepage"
    - url: "https://example.com/products/"
      label: "Products Page"
```

**Flexible Configuration Options:**
- **GA4-only**: Omit `search_console` section for analytics-only setup
- **GSC-only**: Omit `ga4` section for search visibility monitoring
- **Combined**: Include both sections for complete site instrumentation

See [configs/examples/README.md](configs/examples/README.md) for complete documentation.

## Production Features

### Rate Limiting
Protects against API quota exhaustion with configurable requests per second (default: 10 RPS).

### Structured Logging
Production-grade logging with `log/slog` supporting JSON and text formats.

### Input Validation
Validates all inputs against GA4 naming rules, reserved prefixes, and character limits.

### Dry-Run Mode
Preview changes before applying them to your GA4 property.

### Configuration Profiles
Pre-configured profiles for development, production, and default environments.

## Documentation

- [Installation Guide](INSTALL.md) - Detailed setup instructions
- [Configuration Guide](configs/examples/README.md) - YAML configuration reference
- [Error Reference](docs/ERRORS_AND_FAQ.md) - Troubleshooting guide
- [GA4 Tier Limits](docs/TIER_LIMITS_QUICK_REF.md) - Property quota limits
- [Security Policy](SECURITY.md) - Credential management
- [Contributing Guide](CONTRIBUTING.md) - Development setup
- [CI/CD Documentation](docs/development/CI_CD.md) - Continuous integration and deployment
- [Development Docs](docs/development/) - For contributors

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Clone repository
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager

# Install dependencies
go mod download

# Run tests
make test

# Run linter
make lint

# Build binary
make build
```

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md) for reporting instructions.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
