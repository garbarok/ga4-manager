# GA4 Manager MCP Server

> **AI-powered GA4 and Google Search Console management through Model Context Protocol**

A Model Context Protocol (MCP) server that exposes GA4 Manager CLI commands as 13 structured tools for AI assistants. Configure Google Analytics 4 properties, manage Search Console, and query analytics data using natural language with Claude Code, Claude Desktop, and other MCP clients.

[![Tests](https://img.shields.io/badge/tests-720%2B%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.25-purple)]()
[![Tools](https://img.shields.io/badge/MCP%20Tools-13-orange)]()

---

## What is This?

This MCP server bridges AI assistants like **Claude Code** with the GA4 Manager CLI, enabling:

- **Natural language analytics configuration** - "Set up conversion tracking for purchases"
- **Automated Search Console management** - "Submit my sitemap and check indexing status"
- **Data-driven insights** - "Show me top search queries for the last 30 days"
- **Workflow automation** - "Validate config, preview setup, then apply if it looks good"

### What is MCP?

**Model Context Protocol (MCP)** is an open protocol that lets AI assistants interact with external tools and data sources. Think of it as an API designed for AI agents.

**How it works:**
1. AI assistant (Claude Code) receives user request
2. MCP client calls tool on MCP server (this project)
3. MCP server executes GA4 CLI command
4. Structured JSON response returned to AI assistant
5. AI assistant uses data to help user

---

## Features

- ✅ **13 Production-Ready Tools** - Complete GA4 and GSC operation coverage
- ✅ **720+ Passing Tests** - Comprehensive test suite ensures reliability
- ✅ **Structured JSON Output** - All CLI responses parsed to machine-readable format
- ✅ **Intelligent Parsing** - Auto-detects and handles JSON, tables, CSV, markdown
- ✅ **Dry-Run Support** - Preview changes before applying (safe operations)
- ✅ **Quota Tracking** - Monitor Google Search Console API usage
- ✅ **Error Handling** - Actionable error messages with suggestions
- ✅ **Multi-Client Support** - Works with Claude Desktop, Claude CLI, VS Code, Cursor, Cline

---

## Quick Start

### Installation

```bash
# 1. Clone repository
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager

# 2. Build CLI binary
make build

# 3. Build MCP server
cd mcp
npm install
npm run build
```

### Configuration

Choose your client and follow the setup:

#### Claude CLI (Recommended)

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

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ga4-manager": {
      "command": "node",
      "args": ["/absolute/path/to/ga4-manager/mcp/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json",
        "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
        "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4",
        "GA4_DEFAULT_PROPERTY_ID": "123456789"
      }
    }
  }
}
```

#### Other Clients

See **[CONFIGURATION.md](./CONFIGURATION.md)** for setup guides:
- VS Code (via MCP extension)
- Cursor
- Cline
- Custom integrations

### Verify Installation

**Claude Desktop:**
- Restart Claude Desktop
- Click 🔌 icon in bottom-left
- Should show "ga4-manager" with 13 tools

**Claude CLI:**
```bash
claude mcp list
# Should show: ga4-manager (13 tools)
```

**VS Code/Cursor:**
- Check MCP status indicator in status bar

---

## Available Tools (13)

### Tool Categories

**GA4 Analytics (5 tools)** - Configuration and management
- `ga4_setup` - Create conversions, dimensions, metrics
- `ga4_report` - View current configuration
- `ga4_cleanup` - Remove unused resources
- `ga4_link` - External service integration
- `ga4_validate` - Configuration validation

**Search Console (8 tools)** - SEO and indexing
- `gsc_sitemaps_list` - List all sitemaps
- `gsc_sitemaps_submit` - Submit new sitemap
- `gsc_sitemaps_delete` - Remove sitemap
- `gsc_sitemaps_get` - Get sitemap details
- `gsc_inspect_url` - Check URL indexing status
- `gsc_analytics_run` - Search performance data
- `gsc_monitor_urls` - Batch URL monitoring
- `gsc_index_coverage` - Index coverage report

### Tool Operation Types

**Read-Only (Safe):**
- `ga4_report`, `ga4_validate`, `gsc_sitemaps_list`, `gsc_sitemaps_get`, `gsc_inspect_url`, `gsc_analytics_run`, `gsc_monitor_urls`, `gsc_index_coverage`

**Modifying (Use with caution):**
- `ga4_setup`, `ga4_cleanup`, `ga4_link`, `gsc_sitemaps_submit`, `gsc_sitemaps_delete`

**Always use dry-run first for modifying operations!**

---

## Tool Documentation

### GA4 Tools

#### `ga4_setup` - Setup GA4/GSC Configuration

Creates conversions, dimensions, metrics, and Search Console configuration from YAML file.

**Input Schema:**

```typescript
{
  config_path?: string;  // Path to YAML config file
  project_name?: string; // Project name (alternative to config_path)
  all?: boolean;         // Setup all configs in configs/ directory
  dry_run?: boolean;     // Preview without applying (recommended)
}
```

**Example Request:**

```typescript
{
  "config_path": "configs/example-site.yaml",
  "dry_run": true
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "setup",
  "dry_run": true,
  "project": {
    "name": "Example Site",
    "property_id": "123456789"
  },
  "results": {
    "ga4": {
      "conversions_created": 5,
      "conversions_skipped": 2,
      "dimensions_created": 8,
      "metrics_created": 3
    },
    "gsc": {
      "sitemaps_submitted": 2,
      "urls_monitored": 10
    }
  },
  "execution_time_ms": 2345,
  "message": "Dry-run complete. No changes applied."
}
```

**Use Cases:**
- Initial GA4 property setup
- Deploying analytics to new environment
- Bulk configuration changes

---

#### `ga4_report` - View Configuration

Lists existing conversions, dimensions, and metrics for a GA4 property.

**Input Schema:**

```typescript
{
  config_path?: string;  // Path to YAML config
  project_name?: string; // Project name
  all?: boolean;         // Report on all configs
}
```

**Example Request:**

```typescript
{
  "config_path": "configs/example-site.yaml"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "report",
  "project": {
    "name": "Example Site",
    "property_id": "123456789"
  },
  "report": {
    "conversions": [
      {
        "name": "purchase",
        "counting_method": "ONCE_PER_EVENT",
        "status": "active"
      }
    ],
    "dimensions": [
      {
        "parameter": "user_tier",
        "display_name": "User Tier",
        "scope": "USER",
        "status": "active"
      }
    ],
    "metrics": [
      {
        "parameter": "cart_value",
        "display_name": "Cart Value",
        "unit": "CURRENCY",
        "scope": "EVENT"
      }
    ]
  }
}
```

**Use Cases:**
- Audit existing configuration
- Verify setup completed successfully
- Document current state

---

#### `ga4_cleanup` - Remove Unused Resources

Archives unused conversions, dimensions, and metrics to free up quota.

**Input Schema:**

```typescript
{
  config_path?: string;     // Path to YAML config
  project_name?: string;    // Project name
  all?: boolean;            // Cleanup all configs
  type?: string;            // "conversions" | "dimensions" | "metrics" | "all"
  dry_run?: boolean;        // Preview deletions (recommended)
  yes?: boolean;            // Auto-confirm (use with caution)
}
```

**Example Request:**

```typescript
{
  "config_path": "configs/example-site.yaml",
  "type": "all",
  "dry_run": true
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "cleanup",
  "dry_run": true,
  "items_to_remove": {
    "conversions": ["old_event_1", "deprecated_conversion"],
    "dimensions": ["unused_param"],
    "metrics": []
  },
  "quota_freed": {
    "conversions": 2,
    "dimensions": 1,
    "metrics": 0
  },
  "warning": "Archived parameters cannot be reused. Consider new names (e.g., user_type_v2)."
}
```

**Important:**
- Archived dimension/metric parameters are **permanently reserved** (GA4 limitation)
- Always use `dry_run: true` first
- Consider using new parameter names instead of archiving

**Use Cases:**
- Free up quota for new items
- Remove deprecated tracking
- Clean up test configurations

---

#### `ga4_link` - External Service Integration

Manage links to Search Console, BigQuery, and Channel Groups.

**Input Schema:**

```typescript
{
  project_name: string;     // Required: Project name
  service?: string;         // "search-console" | "bigquery" | "channels"
  list?: boolean;           // List existing links
  unlink?: string;          // "bigquery" | "channels" (remove link)
  url?: string;             // Site URL (for search-console)
  gcp_project?: string;     // GCP project (for bigquery)
  dataset?: string;         // BigQuery dataset (for bigquery)
}
```

**Example Request (List):**

```typescript
{
  "project_name": "example-site",
  "list": true
}
```

**Example Request (Link Search Console):**

```typescript
{
  "project_name": "example-site",
  "service": "search-console",
  "url": "https://example.com"
}
```

**Use Cases:**
- Connect GA4 to Search Console
- Setup BigQuery export
- Configure custom channel groups

---

#### `ga4_validate` - Configuration Validation

Validates YAML configuration files against GA4 tier limits and naming rules.

**Input Schema:**

```typescript
{
  config_file?: string;  // Path to config file
  all?: boolean;         // Validate all configs in configs/
  verbose?: boolean;     // Detailed validation output
}
```

**Example Request:**

```typescript
{
  "config_file": "configs/example-site.yaml",
  "verbose": true
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "validate",
  "file": "configs/example-site.yaml",
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [
      "Property tier 'standard' allows max 30 conversions (you have 5)"
    ],
    "details": {
      "conversions": 5,
      "dimensions": 8,
      "metrics": 3,
      "tier": "standard",
      "limits": {
        "conversions": 30,
        "dimensions": 50,
        "metrics": 50
      }
    }
  }
}
```

**Use Cases:**
- Verify config before setup
- Check quota usage
- Identify configuration errors

---

### Google Search Console Tools

#### `gsc_sitemaps_list` - List Sitemaps

Lists all sitemaps submitted for a Search Console property.

**Input Schema:**

```typescript
{
  site: string;  // Required: "sc-domain:example.com" or "https://example.com/"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "sitemaps_list",
  "site": "sc-domain:example.com",
  "sitemaps": [
    {
      "path": "https://example.com/sitemap.xml",
      "type": "sitemapsIndex",
      "submitted": "2024-12-01T10:00:00Z",
      "last_downloaded": "2024-12-27T15:30:00Z",
      "is_pending": false,
      "is_sitemaps_index": true,
      "contents": {
        "submitted": 1500,
        "indexed": 1450
      }
    }
  ],
  "total": 1
}
```

---

#### `gsc_sitemaps_submit` - Submit Sitemap

Submits a new sitemap URL to Search Console for crawling.

**Input Schema:**

```typescript
{
  site: string;  // Required: Site URL
  url: string;   // Required: Sitemap URL
}
```

**Example Request:**

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/sitemap.xml"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "sitemap_submit",
  "site": "sc-domain:example.com",
  "sitemap_url": "https://example.com/sitemap.xml",
  "message": "Sitemap submitted successfully"
}
```

---

#### `gsc_sitemaps_delete` - Delete Sitemap

Removes a sitemap from Search Console (does not delete the actual file).

**Input Schema:**

```typescript
{
  site: string;  // Required: Site URL
  url: string;   // Required: Sitemap URL to remove
}
```

---

#### `gsc_sitemaps_get` - Get Sitemap Details

Retrieves detailed information about a specific sitemap including errors and content breakdown.

**Input Schema:**

```typescript
{
  site: string;  // Required: Site URL
  url: string;   // Required: Sitemap URL
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "sitemap_get",
  "sitemap": {
    "path": "https://example.com/sitemap.xml",
    "type": "sitemapsIndex",
    "submitted": "2024-12-01T10:00:00Z",
    "last_downloaded": "2024-12-27T15:30:00Z",
    "errors": 0,
    "warnings": 2,
    "contents": {
      "web_pages": {
        "submitted": 1000,
        "indexed": 950
      },
      "images": {
        "submitted": 500,
        "indexed": 500
      }
    }
  }
}
```

---

#### `gsc_inspect_url` - URL Indexing Inspection

Inspects a URL's indexing status, mobile usability, rich results, and coverage state.

**Input Schema:**

```typescript
{
  site: string;  // Required: "sc-domain:example.com" (domain property recommended)
  url: string;   // Required: Full URL to inspect
}
```

**Example Request:**

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/products/widget"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "inspect_url",
  "url": "https://example.com/products/widget",
  "inspection_result": {
    "index_status": {
      "verdict": "PASS",
      "coverage_state": "Submitted and indexed",
      "crawled_as": "DESKTOP",
      "last_crawl_time": "2024-12-27T10:30:00Z",
      "page_fetch_state": "SUCCESSFUL",
      "robots_txt_state": "ALLOWED",
      "indexing_state": "INDEXING_ALLOWED"
    },
    "mobile_usability": {
      "verdict": "PASS",
      "issues": []
    },
    "rich_results": {
      "verdict": "PASS",
      "detected_items": [
        {
          "type": "Product",
          "name": "Widget",
          "issues": []
        }
      ]
    },
    "amp": {
      "verdict": "NOT_APPLICABLE"
    }
  },
  "quota": {
    "used": 1,
    "limit": 2000,
    "remaining": 1999,
    "percentage": 0.05
  }
}
```

**Rate Limits:**
- 2,000 inspections per day per property
- 600 inspections per minute per property

**Use Cases:**
- Check why page isn't indexed
- Verify mobile usability
- Validate rich results markup
- Monitor critical pages

---

#### `gsc_analytics_run` - Search Analytics Report

Queries Search Console for performance data: queries, pages, impressions, clicks, CTR, and position.

**Input Schema:**

```typescript
{
  site?: string;            // Site URL (or from config)
  config?: string;          // Config file path (alternative)
  days?: number;            // Period: 1-180 days (default: 30)
  dimensions?: string;      // Comma-separated: "query,page,country,device"
  limit?: number;           // Max rows: 1-25000 (default: 100)
  format?: string;          // Output: "json" | "csv" | "table" | "markdown"
  dry_run?: boolean;        // Preview query parameters
}
```

**Example Request:**

```typescript
{
  "site": "sc-domain:example.com",
  "days": 30,
  "dimensions": "query,page",
  "limit": 50,
  "format": "json"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "gsc_analytics",
  "site_url": "sc-domain:example.com",
  "period": "2024-11-27 to 2024-12-27",
  "total_rows": 50,
  "aggregates": {
    "total_clicks": 1250,
    "total_impressions": 15000,
    "average_ctr": 0.0833,
    "average_position": 8.5
  },
  "rows": [
    {
      "keys": ["best analytics tool", "https://example.com/"],
      "clicks": 45,
      "impressions": 500,
      "ctr": 0.09,
      "position": 3.2
    },
    {
      "keys": ["ga4 setup guide", "https://example.com/blog/ga4-guide"],
      "clicks": 38,
      "impressions": 420,
      "ctr": 0.09,
      "position": 4.1
    }
  ],
  "quota": {
    "used": 1,
    "limit": 2000,
    "remaining": 1999
  }
}
```

**Available Dimensions:**
- `query` - Search query
- `page` - Landing page URL
- `country` - User country (ISO)
- `device` - DESKTOP, MOBILE, TABLET
- `searchAppearance` - How result appeared
- `date` - Individual dates

**Limits:**
- Max 3 dimensions per query
- Data typically 2-3 days behind
- 25,000 rows maximum

**Use Cases:**
- Identify top-performing content
- Find ranking opportunities
- Track keyword performance
- Analyze traffic patterns

---

#### `gsc_monitor_urls` - Batch URL Monitoring

Monitors multiple priority URLs for indexing issues using configuration file or direct URL array.

**Input Schema (Config-based):**

```typescript
{
  config: string;     // Path to YAML config with priority_urls
  format?: string;    // "json" | "table" | "markdown"
  dry_run?: boolean;  // Preview URLs without inspecting
}
```

**Input Schema (Direct URLs):**

```typescript
{
  site: string;       // Site URL
  urls: string[];     // Array of URLs to inspect (max 50)
  dry_run?: boolean;  // Preview without API calls
}
```

**Example Request (Direct):**

```typescript
{
  "site": "sc-domain:example.com",
  "urls": [
    "https://example.com/",
    "https://example.com/products/",
    "https://example.com/blog/"
  ]
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "monitor_urls",
  "site": "sc-domain:example.com",
  "summary": {
    "total": 3,
    "indexed": 3,
    "not_indexed": 0,
    "with_issues": 0
  },
  "results": [
    {
      "url": "https://example.com/",
      "label": "Homepage",
      "verdict": "PASS",
      "coverage_state": "Submitted and indexed",
      "mobile_usability": "PASS",
      "last_crawl": "2024-12-27T10:00:00Z",
      "issues": []
    }
  ],
  "quota": {
    "used": 3,
    "limit": 2000,
    "remaining": 1997
  }
}
```

**Use Cases:**
- Monitor critical pages daily
- Detect indexing issues early
- Track mobile usability
- Audit site after deployment

---

#### `gsc_index_coverage` - Index Coverage Report

Generates index coverage analysis showing indexed, excluded, and error pages based on Search Analytics impressions data.

**Input Schema:**

```typescript
{
  site?: string;      // Site URL (or from config)
  config?: string;    // Config file path
  days?: number;      // Analysis period: 1-180 (default: 90)
  limit?: number;     // Sample size: 1-1000 (default: 1000)
  format?: string;    // "json" | "table" | "markdown"
}
```

**Example Request:**

```typescript
{
  "site": "sc-domain:example.com",
  "days": 90,
  "limit": 1000,
  "format": "json"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "index_coverage",
  "site": "sc-domain:example.com",
  "period": "2024-09-28 to 2024-12-27",
  "analysis": {
    "total_pages": 1000,
    "indexed": 850,
    "low_impressions": 100,
    "no_impressions": 50
  },
  "classification": {
    "healthy": 850,
    "needs_review": 100,
    "excluded": 50
  },
  "top_pages": [
    {
      "url": "https://example.com/",
      "impressions": 5000,
      "clicks": 450,
      "status": "indexed"
    }
  ],
  "recommendations": [
    "50 pages with no impressions may need content improvement or removal",
    "100 pages with low impressions could benefit from SEO optimization"
  ]
}
```

**How It Works:**
- Queries Search Analytics for page impressions
- Classifies pages: ≥10 impressions = indexed, 1-9 = low, 0 = none
- Samples up to 1,000 pages for performance
- Estimates overall index health

**Use Cases:**
- Monitor index health trends
- Identify indexing issues
- Track coverage after site updates
- Estimate indexed page count

---

## Configuration Files

### YAML Config Structure

All tools support YAML configuration files for project settings:

```yaml
project:
  name: Example Site
  description: Production analytics configuration
  version: 1.0.0

# GA4 Configuration
ga4:
  property_id: "123456789"
  tier: standard  # or "360"

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
    scope: EVENT

metrics:
  - parameter: cart_value
    display_name: Cart Value
    description: Total cart value
    unit: CURRENCY
    scope: EVENT

# Search Console Configuration
search_console:
  site_url: "https://example.com"

sitemaps:
  - url: "https://example.com/sitemap.xml"
    priority: true

monitoring:
  priority_urls:
    - url: "https://example.com/"
      label: "Homepage"
    - url: "https://example.com/products/"
      label: "Products Landing Page"
```

### Example Templates

Ready-to-use templates in `examples/`:
- **`minimal.yaml`** - Basic setup for learning
- **`blog.yaml`** - Content sites (5 conversions, 5 dimensions, 3 metrics)
- **`ecommerce.yaml`** - Online stores (7 conversions, 6 dimensions, 4 metrics)
- **`saas.yaml`** - Web applications (6 conversions, 5 dimensions, 3 metrics)

See [`examples/README.md`](./examples/README.md) for template documentation.

---

## Usage Workflows

### Initial Setup Workflow

```typescript
// 1. Validate configuration
await ga4_validate({
  config_file: "configs/example-site.yaml",
  verbose: true
});

// 2. Preview setup (dry-run)
await ga4_setup({
  config_path: "configs/example-site.yaml",
  dry_run: true
});

// 3. Review output, then apply
await ga4_setup({
  config_path: "configs/example-site.yaml",
  dry_run: false
});

// 4. Verify with report
await ga4_report({
  config_path: "configs/example-site.yaml"
});

// 5. Submit sitemaps
await gsc_sitemaps_submit({
  site: "sc-domain:example.com",
  url: "https://example.com/sitemap.xml"
});
```

### Analytics Analysis Workflow

```typescript
// 1. Check index coverage
const coverage = await gsc_index_coverage({
  site: "sc-domain:example.com",
  days: 90,
  limit: 1000
});

// 2. Get search performance
const analytics = await gsc_analytics_run({
  site: "sc-domain:example.com",
  days: 30,
  dimensions: "query,page",
  limit: 100
});

// 3. Inspect top pages
for (const page of analytics.rows.slice(0, 5)) {
  await gsc_inspect_url({
    site: "sc-domain:example.com",
    url: page.keys[1]  // page URL
  });
}
```

### Monitoring Workflow

```typescript
// 1. Monitor critical URLs
const monitoring = await gsc_monitor_urls({
  site: "sc-domain:example.com",
  urls: [
    "https://example.com/",
    "https://example.com/products/",
    "https://example.com/blog/"
  ]
});

// 2. If issues found, inspect details
if (monitoring.summary.with_issues > 0) {
  for (const result of monitoring.results) {
    if (result.issues.length > 0) {
      console.log(`Issues on ${result.url}:`, result.issues);
    }
  }
}
```

---

## Best Practices for AI Assistants

### 1. Always Use Dry-Run First

Before any modifying operation (setup, cleanup, delete), preview changes:

```typescript
// ❌ DON'T do this first
await ga4_setup({ config_path: "config.yaml" });

// ✅ DO this instead
await ga4_setup({ config_path: "config.yaml", dry_run: true });
// Review output, then apply:
await ga4_setup({ config_path: "config.yaml", dry_run: false });
```

### 2. Validate Configurations

Always validate before setup:

```typescript
await ga4_validate({ config_file: "config.yaml", verbose: true });
```

### 3. Monitor Quota Usage

Check `quota.remaining` in responses:

```typescript
const result = await gsc_inspect_url({ ... });
if (result.quota.remaining < 100) {
  console.warn("Low GSC quota remaining:", result.quota.remaining);
}
```

### 4. Use Specific Dimensions

Request only needed dimensions to reduce response size:

```typescript
// ✅ Good - specific dimensions
await gsc_analytics_run({
  dimensions: "query,page",
  limit: 50
});

// ❌ Avoid - too many dimensions
await gsc_analytics_run({
  dimensions: "query,page,country,device,date",
  limit: 25000  // Also too many rows
});
```

### 5. Handle Errors Gracefully

All errors include actionable suggestions:

```typescript
try {
  await ga4_setup({ config_path: "config.yaml" });
} catch (error) {
  console.error(error.code);        // e.g., "AUTH_ERROR"
  console.error(error.message);     // Human-readable message
  console.error(error.suggestion);  // How to fix
}
```

### 6. Provide Context to Users

When presenting results, explain what the data means:

```typescript
const analytics = await gsc_analytics_run({ ... });

// ❌ Don't just dump raw data
console.log(analytics);

// ✅ Explain the insights
console.log(`Top query: "${analytics.rows[0].keys[0]}" with ${analytics.rows[0].clicks} clicks`);
console.log(`Average CTR: ${(analytics.aggregates.average_ctr * 100).toFixed(2)}%`);
```

---

## Error Handling

### Error Response Structure

All errors follow this format:

```json
{
  "code": "AUTH_ERROR",
  "message": "Missing Google credentials",
  "details": {
    "suggestion": "Set GOOGLE_APPLICATION_CREDENTIALS environment variable",
    "stderr": "Error: could not find credentials file",
    "exit_code": 1
  }
}
```

### Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `AUTH_ERROR` | Missing/invalid credentials | Set `GOOGLE_APPLICATION_CREDENTIALS` |
| `VALIDATION_ERROR` | Invalid input parameters | Check parameter types and values |
| `API_ERROR` | Google API error | Check quota, permissions, property ID |
| `CLI_EXECUTION_FAILED` | CLI command failed | Check `GA4_BINARY_PATH`, build binary |
| `TIMEOUT` | Operation timed out | Increase timeout, check network |
| `FILE_NOT_FOUND` | Config file missing | Verify file path is absolute |

### Quota Errors

Search Console has strict quotas:

```json
{
  "code": "API_ERROR",
  "message": "GSC quota exceeded",
  "details": {
    "quota": {
      "used": 2000,
      "limit": 2000,
      "remaining": 0
    },
    "suggestion": "Wait 24 hours for quota reset"
  }
}
```

---

## Rate Limits

### Google Search Console
- **Daily limit:** 2,000 queries per site
- **Per-minute limit:** 600 queries per site
- **Shared across:** All GSC operations (inspect, analytics, sitemaps, coverage)

### Google Analytics 4 Admin API
- **Requests:** 50 per second per project
- **No daily limit** (but stay within reasonable use)

### MCP Server
- No built-in rate limiting (relies on CLI rate limiting)
- CLI has configurable rate limiter (default: 10 RPS)

---

## Development

### Build

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Run with tsx (no compile)
```

### Testing

```bash
npm test             # Run all 720+ tests
npm run test:watch   # Watch mode
npm run test:run     # Single run (CI)
```

### Linting

```bash
npm run lint         # ESLint check
```

### Architecture

```
mcp/
├── src/
│   ├── index.ts              # MCP server entry
│   ├── cli/
│   │   ├── executor.ts       # Subprocess execution
│   │   └── parser.ts         # Output parsing
│   ├── tools/                # 13 tool implementations
│   │   ├── ga4-setup.ts
│   │   ├── ga4-report.ts
│   │   ├── ga4-cleanup.ts
│   │   ├── ga4-link.ts
│   │   ├── ga4-validate.ts
│   │   ├── gsc-sitemaps.ts   # 4 sitemap tools
│   │   ├── gsc-inspect.ts
│   │   ├── gsc-analytics.ts
│   │   ├── gsc-monitor.ts
│   │   └── gsc-coverage.ts
│   ├── utils/
│   │   ├── ansi-strip.ts     # Terminal color removal
│   │   └── errors.ts         # Error mapping
│   └── types/
│       ├── cli.ts            # CLI response types
│       └── mcp.ts            # MCP schemas
└── tests/                     # 720+ comprehensive tests
```

---

## Troubleshooting

### Server Not Connecting

**Symptom:** Claude Desktop doesn't show ga4-manager

**Solution:**
1. Verify `node` in PATH: `which node`
2. Check config uses absolute paths (not relative)
3. Test manually: `node /path/to/mcp/dist/index.js`
4. Check Claude Desktop logs for errors

### Binary Not Found

**Symptom:** `Error: spawn ga4 ENOENT`

**Solution:**
1. Set `GA4_BINARY_PATH` environment variable
2. Build binary: `cd .. && make build`
3. Verify: `ls -la /path/to/ga4`

### Authentication Errors

**Symptom:** `Missing Google credentials`

**Solution:**
1. Set `GOOGLE_APPLICATION_CREDENTIALS` in MCP config
2. Verify file exists: `ls -la /path/to/credentials.json`
3. Check credentials have required OAuth scopes:
   - `https://www.googleapis.com/auth/analytics.edit`
   - `https://www.googleapis.com/auth/analytics.readonly`
   - `https://www.googleapis.com/auth/webmasters`

### Quota Exceeded

**Symptom:** `GSC quota exceeded`

**Solution:**
- GSC daily limit: 2,000 queries
- Wait 24 hours for reset
- Monitor `quota.remaining` in responses
- Use `dry_run: true` for testing

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Path to service account JSON |
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project ID |
| `GA4_BINARY_PATH` | Yes | Path to ga4 binary |
| `GA4_DEFAULT_PROPERTY_ID` | No | Default property ID (optional) |
| `GSC_DEFAULT_SITE` | No | Default GSC site URL (optional) |

---

## Additional Documentation

- **[CONFIGURATION.md](./CONFIGURATION.md)** - Multi-client setup guides
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history
- **[examples/README.md](./examples/README.md)** - Template documentation
- **[../CLAUDE.md](../CLAUDE.md)** - CLI documentation for Claude Code
- **[../README.md](../README.md)** - Main project README

---

## Support

- **Issues:** [GitHub Issues](https://github.com/garbarok/ga4-manager/issues)
- **Discussions:** [GitHub Discussions](https://github.com/garbarok/ga4-manager/discussions)
- **Security:** See [SECURITY.md](../SECURITY.md) for vulnerability reporting

---

## License

MIT - See [LICENSE](../LICENSE) for details

---

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for complete version history and release notes.

**Current Version:** 2.0.0+ (720+ tests passing)

---

<p align="center">
  Built with <a href="https://modelcontextprotocol.io">Model Context Protocol</a><br/>
  Powered by <a href="https://github.com/modelcontextprotocol/typescript-sdk">MCP TypeScript SDK</a>
</p>
