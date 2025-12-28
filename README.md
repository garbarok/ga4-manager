# GA4 Manager

> **Automate Google Analytics 4 configuration at scale**

A production-ready CLI tool for managing GA4 properties and Google Search Console integration. Configure conversion events, custom dimensions, metrics, sitemaps, and search analytics from simple YAML files.

[![Test Status](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml)
[![Security](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml)
[![Release](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml)
[![Go Report Card](https://goreportcard.com/badge/github.com/garbarok/ga4-manager)](https://goreportcard.com/report/github.com/garbarok/ga4-manager)
[![Latest Release](https://img.shields.io/github/v/release/garbarok/ga4-manager)](https://github.com/garbarok/ga4-manager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go)](https://go.dev/)

---

## Why GA4 Manager?

Managing GA4 properties through the web UI is time-consuming and error-prone. GA4 Manager solves this by:

- **Automating configuration** - Define your analytics setup in YAML, apply it with one command
- **Ensuring consistency** - Same configuration across dev/staging/production environments
- **Saving time** - Bulk operations instead of clicking through the UI for each item
- **Version control** - Track analytics changes in git alongside your application code
- **Unified workflow** - Configure both GA4 and Google Search Console from a single file

**Perfect for:**
- Development teams managing multiple GA4 properties
- Agencies handling analytics for many clients
- DevOps/CI pipelines requiring automated analytics setup
- Anyone tired of manual GA4 configuration

---

## Quick Start

Get up and running in 5 minutes:

### 1. Install

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

### 2. Configure Google Cloud Credentials

**Option A: Interactive Setup Wizard (Recommended)**

```bash
ga4 init
```

The wizard will:
- Prompt for your service account credentials path
- Prompt for your GCP project ID
- Validate the credentials
- Optionally save to `.env` file
- Provide shell-specific export instructions

**Option B: Manual Configuration**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
```

See [INSTALL.md](INSTALL.md) for detailed credential setup instructions.

### 3. Create a Configuration File

```bash
# Start with an example template
cp configs/examples/basic-ecommerce.yaml configs/example-site.yaml

# Edit with your GA4 property ID and site URL
vim configs/example-site.yaml
```

**Minimal configuration:**

```yaml
project:
  name: Example Site
  version: 1.0.0

ga4:
  property_id: "123456789"
  tier: standard

conversions:
  - name: purchase
    counting_method: ONCE_PER_EVENT
    description: User completed purchase

search_console:
  site_url: "https://example.com"

sitemaps:
  - url: "https://example.com/sitemap.xml"
```

### 4. Run GA4 Manager

**Option A: Interactive Mode (Recommended)**

```bash
# Launch interactive menu
ga4
```

Navigate with arrow keys, select commands with Enter.

**Option B: CLI Commands**

```bash
# Validate configuration
ga4 validate configs/example-site.yaml

# Preview changes (dry run)
ga4 setup --config configs/example-site.yaml --dry-run

# Apply configuration
ga4 setup --config configs/example-site.yaml
```

**Output:**

```
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

✓ Pre-flight validation passed

[1/2] ✓ Google Analytics 4 Setup
  ✓ purchase (conversion created)

[2/2] ✓ Google Search Console Setup
  ✓ Submitted sitemap: https://example.com/sitemap.xml

Setup Summary:
  ✓ 2 steps completed
  Duration: 4.2 seconds
```

---

## Features

### Google Analytics 4

- **🎯 Conversion Events** - Create and manage GA4 conversion events
- **📊 Custom Dimensions** - Define custom dimensions with proper scoping (USER/EVENT)
- **📈 Custom Metrics** - Create metrics with units (CURRENCY, SECONDS, STANDARD, etc.)
- **🧹 Cleanup** - Remove unused events, dimensions, and metrics to free up quota
- **✅ Validation** - Validate YAML files before deployment
- **🔗 External Links** - Setup guides for Search Console, BigQuery, and Channel Groups

### Google Search Console

- **🗺️ Sitemap Management** - Submit and verify sitemaps automatically
- **🔍 URL Inspection** - Check indexing status, mobile usability, and rich results
- **📊 Search Analytics** - Query performance data (impressions, clicks, CTR, position)
- **📋 Index Coverage** - Monitor indexed vs. excluded pages
- **⚡ Batch Monitoring** - Track multiple priority URLs at once

### Production-Ready

- **🛡️ Pre-flight Validation** - Verify credentials, permissions, and quota before making changes
- **🔄 Rollback** - Automatic cleanup if setup fails
- **📈 Progress Tracking** - Real-time status with color-coded indicators
- **🏭 Enterprise Features**
  - Rate limiting (10 RPS, configurable)
  - Structured logging (JSON/text with slog)
  - Input validation (GA4 naming rules, reserved prefixes)
  - Dry-run mode (preview without applying)
  - Multi-project support

---

## Installation

### Pre-built Binaries (Recommended)

Download for your platform:

| Platform | Architecture | Download |
|----------|--------------|----------|
| macOS | Apple Silicon (M1/M2/M3) | [ga4-darwin-arm64.tar.gz](https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-arm64.tar.gz) |
| macOS | Intel | [ga4-darwin-amd64.tar.gz](https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-darwin-amd64.tar.gz) |
| Linux | x86_64 | [ga4-linux-amd64.tar.gz](https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-linux-amd64.tar.gz) |
| Linux | ARM64 | [ga4-linux-arm64.tar.gz](https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-linux-arm64.tar.gz) |
| Windows | x86_64 | [ga4-windows-amd64.zip](https://github.com/garbarok/ga4-manager/releases/latest/download/ga4-windows-amd64.zip) |

### Build from Source

Requires Go 1.25+:

```bash
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager
make build
sudo make install
```

### Verify Installation

```bash
ga4 --version
```

For detailed setup including Google Cloud credentials, see [INSTALL.md](INSTALL.md).

---

## Usage

### Interactive Mode ✨

Launch an interactive terminal UI to navigate all GA4 Manager commands:

```bash
# Run without arguments to open interactive menu
ga4

# Or explicitly use interactive command
ga4 interactive
```

**Navigation:**
- `↑/k` - Move up
- `↓/j` - Move down
- `Enter/Space` - Select option
- `q/Esc` - Quit
- `/` - Filter/search (in project selector)

**Available actions:**
- 🔧 Initial Setup (Credentials)
- 📊 View Reports
- ⚙️ Setup Projects
- 🧹 Cleanup Unused Items
- 🔗 Manage Links
- ✅ Validate Configs
- ❌ Exit

**Workflow:**
1. Select an action (e.g., "View Reports")
2. Pick a project from the selector:
   - Shows all `.yaml` files in `configs/`
   - Displays project name and GA4 Property ID
   - Includes "All Projects" option
   - Searchable with `/` key
3. Command runs automatically with selected project

**Example:**
```
Select a Project
  All Projects
  My E-commerce Store (Property: 123456789)
→ My Blog (Property: 987654321)
  My SaaS App (Property: 456789123)
```

### Initial Setup (Credentials)

Configure your Google Cloud credentials interactively:

```bash
ga4 init
```

**Features:**
- 📝 Interactive form for credentials path and project ID
- ✅ Real-time file path validation
- 🔍 Credential testing (verifies API access)
- 💾 Optional .env file creation
- 📚 Shell-specific export instructions (Bash/Zsh/Fish)

**Example workflow:**

```
🚀 GA4 Manager Setup Wizard

Let's configure your Google Cloud credentials!

┃ Google Cloud Credentials Path
┃ /Users/you/Downloads/ga4-credentials.json
┃
┃ Google Cloud Project ID
┃ my-gcp-project-123
┃
┃ Save to .env file? Yes
┃
┃ Shell Type: Zsh (~/.zshrc)

💾 Saving configuration to .env file...
✓ Configuration saved to .env

🔍 Testing credentials...
✓ Credentials are valid!

📝 Shell Configuration
Add these lines to ~/.zshrc:

  export GOOGLE_APPLICATION_CREDENTIALS="/Users/you/Downloads/ga4-credentials.json"
  export GOOGLE_CLOUD_PROJECT="my-gcp-project-123"

Then run: source ~/.zshrc

✅ Next Steps
  1. Add the environment variables to your shell config
  2. Source your shell config or restart your terminal
  3. Run: ga4 validate --all
  4. Start using: ga4
```

### Unified Setup (GA4 + Search Console)

Configure both GA4 and GSC with a single command:

```bash
# Setup from configuration file
ga4 setup --config configs/example-site.yaml

# Preview changes first
ga4 setup --config configs/example-site.yaml --dry-run

# Setup multiple projects
ga4 setup --all
```

**What happens during setup:**

1. ✅ **Pre-flight validation** - Verifies credentials, permissions, and detects conflicts
2. 📊 **GA4 setup** - Creates conversions, dimensions, and metrics (skips duplicates)
3. 🔍 **Search Console setup** - Submits sitemaps and configures monitoring
4. 📈 **Progress tracking** - Real-time status with duration
5. 🔄 **Rollback on error** - Automatic cleanup if anything fails

### View Current Configuration

```bash
# Show GA4 configuration for a project
ga4 report --config configs/example-site.yaml

# Report on all projects
ga4 report --all
```

### Cleanup Unused Resources

```bash
# Preview cleanup (safe)
ga4 cleanup --config configs/example-site.yaml --dry-run

# Remove unused conversions
ga4 cleanup --config configs/example-site.yaml --type conversions

# Remove unused dimensions
ga4 cleanup --config configs/example-site.yaml --type dimensions

# Remove unused metrics
ga4 cleanup --config configs/example-site.yaml --type metrics

# Remove everything
ga4 cleanup --config configs/example-site.yaml --type all
```

**Important:** Archived dimensions/metrics reserve their parameter names permanently (GA4 limitation). Consider using new names (e.g., `user_type_v2`) for future use.

### External Service Links

```bash
# List existing links
ga4 link --project example-site --list

# Setup Search Console integration
ga4 link --project example-site --service search-console

# Configure custom channel groups
ga4 link --project example-site --service channels
```

### Validate Configuration

```bash
# Validate a specific file
ga4 validate configs/example-site.yaml

# Validate all configs
ga4 validate --all
```

---

## Configuration

GA4 Manager uses YAML files to define your analytics setup. Templates are provided in `configs/examples/`:

- **template.yaml** - Minimal starter template
- **basic-ecommerce.yaml** - E-commerce store configuration
- **content-site.yaml** - Blog/content site configuration

### Configuration Structure

```yaml
project:
  name: Example Site
  description: Production analytics configuration
  version: 1.0.0

# Google Analytics 4 Configuration (optional)
ga4:
  property_id: "123456789"  # Your GA4 property ID
  tier: standard             # standard or 360

conversions:
  - name: purchase
    counting_method: ONCE_PER_EVENT
    description: User completed purchase

  - name: signup
    counting_method: ONCE_PER_SESSION
    description: User created account

dimensions:
  - parameter: user_tier
    display_name: User Tier
    description: User subscription level
    scope: USER

  - parameter: product_category
    display_name: Product Category
    description: Category of purchased product
    scope: EVENT

metrics:
  - parameter: cart_value
    display_name: Cart Value
    description: Total cart value in USD
    unit: CURRENCY
    scope: EVENT

  - parameter: session_duration_custom
    display_name: Session Duration
    description: Custom session duration tracking
    unit: SECONDS
    scope: EVENT

# Google Search Console Configuration (optional)
search_console:
  site_url: "https://example.com"

sitemaps:
  - url: "https://example.com/sitemap.xml"
    priority: true

  - url: "https://example.com/news-sitemap.xml"

monitoring:
  priority_urls:
    - url: "https://example.com/"
      label: "Homepage"

    - url: "https://example.com/products/"
      label: "Products Landing Page"
```

**Flexible Configuration:**
- **GA4-only** - Omit `search_console` section for analytics-only
- **GSC-only** - Omit `ga4` section for search visibility monitoring
- **Combined** - Include both for complete instrumentation

See [configs/examples/README.md](configs/examples/README.md) for complete documentation and all available options.

---

## MCP Server Integration

GA4 Manager includes a **Model Context Protocol (MCP) server** that exposes all CLI commands as structured tools for AI assistants and development environments.

### What is MCP?

MCP (Model Context Protocol) lets AI assistants like Claude Code interact with external tools and data sources. The GA4 Manager MCP server provides 13 tools that AI assistants can use to:

- Configure GA4 properties
- Manage Search Console
- Query analytics data
- Inspect URLs for indexing issues
- Submit sitemaps
- And more

### Supported Clients

- ✅ **Claude Desktop** - Native MCP integration
- ✅ **Claude CLI** - Command-line interface
- ✅ **Claude Code** - VS Code extension
- ✅ **Cursor** - AI-powered editor
- ✅ **Cline** - VS Code extension

### Quick Setup

```bash
# Using Claude CLI
claude mcp add \
  --name ga4-manager \
  --transport stdio \
  --command "node" \
  --args "/absolute/path/to/ga4-manager/mcp/dist/index.js" \
  --env "GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json" \
  --env "GOOGLE_CLOUD_PROJECT=your-gcp-project-id" \
  --env "GA4_BINARY_PATH=/absolute/path/to/ga4-manager/ga4"
```

### Available Tools (13)

**GA4 Tools (5):**
- `ga4_setup` - Setup from YAML configuration
- `ga4_report` - View current configuration
- `ga4_cleanup` - Remove unused resources
- `ga4_link` - External service integration
- `ga4_validate` - Validate configuration files

**Search Console Tools (8):**
- `gsc_sitemaps_list` - List sitemaps
- `gsc_sitemaps_submit` - Submit new sitemap
- `gsc_sitemaps_delete` - Delete sitemap
- `gsc_sitemaps_get` - Get sitemap details
- `gsc_inspect_url` - Inspect URL indexing status
- `gsc_analytics_run` - Query search analytics
- `gsc_monitor_urls` - Batch URL monitoring
- `gsc_index_coverage` - Index coverage report

### Documentation

- **[MCP Server README](mcp/README.md)** - Complete tool documentation and examples
- **[Configuration Guide](mcp/CONFIGURATION.md)** - Setup for all MCP clients
- **[Example Configs](mcp/examples/)** - Ready-to-use templates

---

## Documentation

- **[Installation Guide](INSTALL.md)** - Detailed setup and credential configuration
- **[Configuration Reference](configs/examples/README.md)** - Complete YAML structure
- **[Error Reference](docs/ERRORS_AND_FAQ.md)** - Troubleshooting common issues
- **[GA4 Tier Limits](docs/TIER_LIMITS_QUICK_REF.md)** - Property quota limits
- **[Security Policy](SECURITY.md)** - Credential management best practices
- **[CI/CD Integration](docs/development/CI_CD.md)** - Automated deployment
- **[MCP Server Docs](mcp/)** - AI assistant integration

---

## Contributing

Contributions are welcome! Whether you're fixing bugs, adding features, or improving documentation.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`make test && make lint`)
5. Commit your changes
6. Push to your branch
7. Open a Pull Request

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for detailed guidelines.

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

# MCP server development
cd mcp
npm install
npm test  # 720+ tests
npm run dev
```

---

## Support

- **Issues** - [GitHub Issues](https://github.com/garbarok/ga4-manager/issues)
- **Discussions** - [GitHub Discussions](https://github.com/garbarok/ga4-manager/discussions)
- **Security** - See [SECURITY.md](SECURITY.md) for reporting vulnerabilities

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

---

<p align="center">
  Made with ❤️ for the GA4 community
</p>
