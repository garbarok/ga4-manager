# GA4 Manager MCP Server

> MCP server exposing GA4 Manager CLI as structured tools for Claude Desktop and Claude Code CLI

[![Tests](https://img.shields.io/badge/tests-593%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.25-purple)]()

## Features

- **12 MCP Tools** - Complete coverage of GA4 & Google Search Console operations
- **Structured JSON** - All outputs parsed to machine-readable format
- **Production Ready** - 593 passing tests, comprehensive error handling
- **Dry-Run Support** - Preview changes before applying them
- **Quota Tracking** - Monitor GSC API quota usage
- **Smart Parsing** - Automatic detection of JSON, tables, CSV, and markdown

## Quick Start

### Installation

```bash
cd mcp
npm install
npm run build
```

### Configuration

Configure for your client - choose one:

#### Claude Desktop

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

#### Claude CLI

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

#### Other Clients (VS Code, Cursor, Cline)

See **[CONFIGURATION.md](./CONFIGURATION.md)** for complete setup guides for all clients.

### Verify Installation

- **Claude Desktop:** Restart and check 🔌 icon - should show "ga4-manager" with 12 tools
- **Claude CLI:** Run `claude mcp list` - should show ga4-manager
- **VS Code/Cursor:** Check MCP status in status bar

## Available Tools

### GA4 Analytics Tools (5)

#### 1. `ga4_setup` - Setup GA4/GSC Configuration

Creates conversions, dimensions, and metrics from YAML config.

```typescript
{
  "config_path": "configs/my-site.yaml",  // Path to YAML config
  "dry_run": true                          // Preview without applying
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "setup",
  "project": {
    "name": "My Website",
    "property_id": "123456789"
  },
  "results": {
    "ga4": {
      "conversions_created": 5,
      "dimensions_created": 8,
      "metrics_created": 3
    },
    "gsc": {
      "sitemaps_submitted": 2
    }
  },
  "dry_run": true,
  "execution_time_ms": 2345
}
```

#### 2. `ga4_report` - Configuration Reports

Lists existing conversions, dimensions, and metrics.

```typescript
{
  "config_path": "configs/my-site.yaml"
}
```

#### 3. `ga4_cleanup` - Remove Unused Items

Archives unused conversions, dimensions, and metrics.

```typescript
{
  "config_path": "configs/my-site.yaml",
  "type": "all",        // "conversions" | "dimensions" | "metrics" | "all"
  "dry_run": true,      // Preview deletions
  "yes": false          // Auto-confirm (use with caution)
}
```

#### 4. `ga4_link` - External Service Integration

Manage BigQuery, Search Console, and Channel Group links.

```typescript
{
  "project_name": "snapcompress",
  "service": "channels",    // "search-console" | "bigquery" | "channels"
  "list": true              // List existing links
}
```

#### 5. `ga4_validate` - Config Validation

Validates YAML configuration files before setup.

```typescript
{
  "config_file": "configs/my-site.yaml",
  "verbose": true
}
```

### Google Search Console Tools (7)

#### 6. `gsc_sitemaps_list` - List Sitemaps

```typescript
{
  "site": "sc-domain:example.com"
}
```

#### 7. `gsc_sitemaps_submit` - Submit Sitemap

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/sitemap.xml"
}
```

#### 8. `gsc_sitemaps_delete` - Delete Sitemap

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/sitemap.xml"
}
```

#### 9. `gsc_sitemaps_get` - Get Sitemap Details

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/sitemap.xml"
}
```

#### 10. `gsc_inspect_url` - URL Indexing Status

Inspect a single URL's indexing status, coverage, and mobile usability.

```typescript
{
  "site": "sc-domain:example.com",
  "url": "https://example.com/my-page"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "inspect_url",
  "url": "https://example.com/my-page",
  "verdict": "PASS",
  "coverage_state": "Submitted and indexed",
  "last_crawl": "2024-12-27T10:30:00Z",
  "mobile_usability": "PASS",
  "issues": [],
  "quota": {
    "used": 15,
    "limit": 2000,
    "remaining": 1985,
    "percentage": 0.75
  }
}
```

#### 11. `gsc_analytics_run` - Search Analytics Report

Generate search performance reports with clicks, impressions, CTR, and position data.

```typescript
{
  "site": "sc-domain:example.com",
  "days": 30,                          // 1-180 days
  "dimensions": "query,page",          // Comma-separated
  "limit": 100,                        // Max rows (1-25000)
  "format": "json"                     // "json" | "table" | "csv" | "markdown"
}
```

**Example Response:**

```json
{
  "success": true,
  "operation": "gsc_analytics",
  "site_url": "sc-domain:example.com",
  "period": "2024-11-27 to 2024-12-27",
  "total_rows": 150,
  "aggregates": {
    "total_clicks": 1250,
    "total_impressions": 15000,
    "average_ctr": 0.0833,
    "average_position": 8.5
  },
  "rows": [
    {
      "keys": ["best image compressor", "https://example.com/"],
      "clicks": 45,
      "impressions": 500,
      "ctr": 0.09,
      "position": 3.2
    }
  ],
  "quota": {
    "used": 15,
    "limit": 2000,
    "remaining": 1985
  }
}
```

#### 12. `gsc_monitor_urls` - Batch URL Monitoring

Monitor multiple URLs from config file.

```typescript
{
  "config": "configs/my-site.yaml",
  "format": "json"
}
```

## Configuration Files

### Quick Start with Examples

We provide ready-to-use templates for common use cases:

- **`examples/minimal.yaml`** - Basic setup for learning
- **`examples/blog.yaml`** - Content sites and blogs
- **`examples/ecommerce.yaml`** - Online stores
- **`examples/saas.yaml`** - Web applications

**Copy and customize:**

```bash
cp mcp/examples/blog.yaml configs/my-site.yaml
# Edit configs/my-site.yaml with your property ID
```

See [`examples/README.md`](./examples/README.md) for detailed template documentation.

### YAML Config Structure

```yaml
project:
  name: 'My Website'
  property_id: '123456789'
  timezone: 'America/New_York'

ga4:
  conversions:
    - name: 'article_read'
      counting_method: 'ONCE_PER_SESSION'
    - name: 'newsletter_subscribe'
      counting_method: 'ONCE_PER_EVENT'

  dimensions:
    - parameter: 'user_type'
      display_name: 'User Type'
      scope: 'USER'
    - parameter: 'article_category'
      display_name: 'Article Category'
      scope: 'EVENT'

  metrics:
    - parameter: 'reading_time'
      display_name: 'Reading Time'
      scope: 'EVENT'
      unit: 'SECONDS'

gsc:
  sites:
    - url: 'sc-domain:example.com'
      sitemaps:
        - 'https://example.com/sitemap.xml'

  monitor_urls:
    - 'https://example.com/'
    - 'https://example.com/blog/'
```

See [`CONFIGURATION.md`](./CONFIGURATION.md) for complete configuration reference.

## Development

### Build

```bash
npm run build        # Compile TypeScript
npm run dev          # Run with tsx (development)
```

### Testing

```bash
npm test             # Run all tests (593 tests)
npm run test:watch   # Watch mode
npm run test:run     # Single run (CI)
```

### Linting

```bash
npm run lint         # ESLint check
```

## Architecture

```
mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── cli/
│   │   ├── executor.ts       # CLI subprocess execution
│   │   └── parser.ts         # Output parsing (JSON/table/CSV)
│   ├── tools/                # 12 tool implementations
│   │   ├── ga4-setup.ts
│   │   ├── ga4-report.ts
│   │   ├── ga4-cleanup.ts
│   │   ├── ga4-link.ts
│   │   ├── ga4-validate.ts
│   │   ├── gsc-sitemaps.ts   # 4 sitemap tools
│   │   ├── gsc-inspect.ts
│   │   ├── gsc-analytics.ts
│   │   └── gsc-monitor.ts
│   ├── utils/
│   │   ├── ansi-strip.ts     # Terminal color stripping
│   │   └── errors.ts         # Error mapping
│   └── types/
│       ├── cli.ts            # CLI response types
│       └── mcp.ts            # MCP schemas
└── tests/                     # 593 comprehensive tests
```

## Error Handling

All errors include structured details:

```json
{
  "code": "AUTH_ERROR",
  "message": "Missing Google credentials",
  "details": {
    "suggestion": "Set GOOGLE_APPLICATION_CREDENTIALS environment variable",
    "stderr": "Error: credentials not found"
  }
}
```

Common error codes:

- `AUTH_ERROR` - Missing/invalid credentials
- `VALIDATION_ERROR` - Invalid input parameters
- `API_ERROR` - Google API errors (quota, permissions)
- `CLI_EXECUTION_FAILED` - CLI command failures

## Troubleshooting

### Server Not Connecting

**Issue:** Claude Desktop doesn't show ga4-manager

**Fix:**

1. Check config path is absolute (not relative)
2. Verify `node` is in PATH: `which node`
3. Check server logs: Look for stderr output in Claude Desktop logs
4. Test manually: `node /path/to/mcp/dist/index.js`

### Binary Not Found

**Issue:** `Error: spawn ga4 ENOENT`

**Fix:**

1. Set `GA4_BINARY_PATH` environment variable
2. Build binary: `cd .. && make build`
3. Verify path: `ls -la /path/to/ga4`

### Authentication Errors

**Issue:** `Missing Google credentials`

**Fix:**

1. Set `GOOGLE_APPLICATION_CREDENTIALS` in config
2. Verify file exists: `ls -la /path/to/credentials.json`
3. Check credentials have required scopes:
   - `https://www.googleapis.com/auth/analytics.edit`
   - `https://www.googleapis.com/auth/analytics.readonly`
   - `https://www.googleapis.com/auth/webmasters`

### Quota Exceeded

**Issue:** `API quota exceeded`

**Fix:**

- GSC has daily limit of 2,000 queries
- Wait 24 hours for reset
- Monitor quota in tool responses (`quota.remaining`)

## Production Usage

### Best Practices

1. **Always use dry-run first**

   ```typescript
   { "dry_run": true }
   ```

2. **Validate configs before setup**

   ```typescript
   ga4_validate({ config_file: 'configs/my-site.yaml' })
   ```

3. **Monitor quota usage**
   - Check `quota.remaining` in responses
   - Stay under 2,000 queries/day for GSC

4. **Use specific dimensions**
   - Request only needed dimensions in analytics
   - Reduces response size and processing time

### Rate Limits

- **GSC API:** 2,000 queries/day (shared across all operations)
- **GA4 Admin API:** 50 requests/second/project
- **MCP Server:** No built-in limits (relies on CLI)

## Examples

### Complete Setup Workflow

```typescript
// 1. Validate config
ga4_validate({
  config_file: 'configs/snapcompress.yaml',
  verbose: true,
})

// 2. Preview setup
ga4_setup({
  config_path: 'configs/snapcompress.yaml',
  dry_run: true,
})

// 3. Apply setup
ga4_setup({
  config_path: 'configs/snapcompress.yaml',
  dry_run: false,
})

// 4. Verify with report
ga4_report({
  config_path: 'configs/snapcompress.yaml',
})
```

### Analytics Analysis

```typescript
// Get 30-day search performance
gsc_analytics_run({
  site: 'sc-domain:snapcompress.io',
  days: 30,
  dimensions: 'query,page',
  limit: 100,
  format: 'json',
})

// Monitor critical pages
gsc_monitor_urls({
  config: 'configs/snapcompress.yaml',
  format: 'json',
})
```

## License

MIT

## Support

- **Issues:** [GitHub Issues](https://github.com/garbarok/ga4-manager/issues)
- **Documentation:** See [CONFIGURATION.md](./CONFIGURATION.md)
- **CLI Docs:** See [../CLAUDE.md](../CLAUDE.md)

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

Built with [Model Context Protocol](https://modelcontextprotocol.io) and the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
