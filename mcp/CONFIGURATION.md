# GA4 Manager MCP Configuration Guide

Complete guide for configuring the GA4 Manager MCP server across different clients and environments.

## Table of Contents

- [Installation](#installation)
- [Client Setup](#client-setup)
  - [Claude Desktop](#claude-desktop)
  - [Claude CLI](#claude-cli)
  - [VS Code](#vs-code)
  - [Cursor](#cursor)
  - [Cline](#cline)
- [Environment Variables](#environment-variables)
- [YAML Configuration](#yaml-configuration)
- [Advanced Configuration](#advanced-configuration)

---

## Installation

### Prerequisites

1. **Build the ga4 binary**:
   ```bash
   cd /path/to/ga4-manager
   make build
   # Verify: ./ga4 --version
   ```

2. **Install MCP server dependencies**:
   ```bash
   cd /path/to/ga4-manager/mcp
   npm install
   npm run build
   ```

3. **Google Cloud credentials**:
   - Create a service account with GA4 and GSC permissions
   - Download JSON credentials
   - Note the file path

---

## Client Setup

### Claude Desktop

**Config Location:** `~/.config/claude-desktop/config.json` (macOS/Linux) or `%APPDATA%\Claude\config.json` (Windows)

#### Basic Setup

```json
{
  "mcpServers": {
    "ga4-manager": {
      "command": "node",
      "args": [
        "/absolute/path/to/ga4-manager/mcp/dist/index.js"
      ],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json",
        "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
        "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4"
      }
    }
  }
}
```

#### With Default Property ID

```json
{
  "mcpServers": {
    "ga4-manager": {
      "command": "node",
      "args": [
        "/absolute/path/to/ga4-manager/mcp/dist/index.js"
      ],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json",
        "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
        "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4",
        "GA4_DEFAULT_PROPERTY_ID": "513421535",
        "GSC_DEFAULT_SITE": "sc-domain:example.com"
      }
    }
  }
}
```

**Restart Claude Desktop** to apply changes.

### Claude CLI

Install using `claude mcp add` command:

```bash
# Add GA4 Manager MCP server
claude mcp add \
  --name ga4-manager \
  --transport stdio \
  --command "node" \
  --args "/absolute/path/to/ga4-manager/mcp/dist/index.js" \
  --env "GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/credentials.json" \
  --env "GOOGLE_CLOUD_PROJECT=your-gcp-project-id" \
  --env "GA4_BINARY_PATH=/absolute/path/to/ga4-manager/ga4"
```

**With default property ID:**

```bash
claude mcp add \
  --name ga4-manager \
  --transport stdio \
  --command "node" \
  --args "/absolute/path/to/ga4-manager/mcp/dist/index.js" \
  --env "GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/credentials.json" \
  --env "GOOGLE_CLOUD_PROJECT=your-gcp-project-id" \
  --env "GA4_BINARY_PATH=/absolute/path/to/ga4-manager/ga4" \
  --env "GA4_DEFAULT_PROPERTY_ID=513421535" \
  --env "GSC_DEFAULT_SITE=sc-domain:example.com"
```

**Verify installation:**

```bash
claude mcp list
# Should show: ga4-manager (12 tools)
```

**Update existing server:**

```bash
claude mcp update ga4-manager \
  --env "GA4_DEFAULT_PROPERTY_ID=NEW_PROPERTY_ID"
```

**Remove server:**

```bash
claude mcp remove ga4-manager
```

### VS Code

Use the [MCP Extension](https://marketplace.visualstudio.com/items?itemName=modelcontextprotocol.mcp-vscode)

1. **Install MCP extension**:
   ```
   code --install-extension modelcontextprotocol.mcp-vscode
   ```

2. **Configure in settings.json**:
   - Open: `Cmd+Shift+P` → "Preferences: Open Settings (JSON)"
   - Add:
   ```json
   {
     "mcp.servers": {
       "ga4-manager": {
         "command": "node",
         "args": [
           "/absolute/path/to/ga4-manager/mcp/dist/index.js"
         ],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json",
           "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
           "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4",
           "GA4_DEFAULT_PROPERTY_ID": "513421535"
         }
       }
     }
   }
   ```

3. **Reload window**: `Cmd+Shift+P` → "Developer: Reload Window"

### Cursor

Cursor uses the same config format as VS Code:

1. **Open Cursor settings**: `Cmd+,`
2. **Search**: "MCP" or "Model Context Protocol"
3. **Add server configuration**:

```json
{
  "mcp.servers": {
    "ga4-manager": {
      "command": "node",
      "args": [
        "/absolute/path/to/ga4-manager/mcp/dist/index.js"
      ],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json",
        "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
        "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4",
        "GA4_DEFAULT_PROPERTY_ID": "513421535"
      }
    }
  }
}
```

**Restart Cursor** to load the server.

### Cline

For Cline (VS Code extension), configure via Cline settings:

1. Open Cline settings
2. Navigate to MCP servers
3. Add server:

```json
{
  "name": "ga4-manager",
  "command": "node",
  "args": [
    "/absolute/path/to/ga4-manager/mcp/dist/index.js"
  ],
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/credentials.json",
    "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
    "GA4_BINARY_PATH": "/absolute/path/to/ga4-manager/ga4"
  }
}
```

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON | `/path/to/credentials.json` |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | `my-analytics-project` |
| `GA4_BINARY_PATH` | Path to ga4 binary | `/path/to/ga4-manager/ga4` |

### Optional Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `GA4_DEFAULT_PROPERTY_ID` | Default GA4 property ID | None | `513421535` |
| `GSC_DEFAULT_SITE` | Default GSC site URL | None | `sc-domain:example.com` |
| `GA4_CONFIG_DIR` | Directory for YAML configs | `./configs` | `/path/to/configs` |
| `GA4_TIMEOUT` | CLI execution timeout (ms) | `30000` | `60000` |

### Using Default Property ID

When `GA4_DEFAULT_PROPERTY_ID` is set, you can omit `config_path` in tool calls:

**Without default:**
```typescript
ga4_report({
  "config_path": "configs/my-site.yaml"
})
```

**With default:**
```typescript
// Uses GA4_DEFAULT_PROPERTY_ID automatically
ga4_report({})
```

### Environment-Specific Configs

**Production:**
```json
{
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/prod/credentials.json",
    "GA4_DEFAULT_PROPERTY_ID": "513421535",
    "GSC_DEFAULT_SITE": "sc-domain:example.com"
  }
}
```

**Development:**
```json
{
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/dev/credentials.json",
    "GA4_DEFAULT_PROPERTY_ID": "513885304",
    "GSC_DEFAULT_SITE": "sc-domain:dev.example.com"
  }
}
```

---

## YAML Configuration

### Complete Config Reference

```yaml
# Project metadata
project:
  name: "My Website"                    # Required: Project name
  property_id: "513421535"              # Required: GA4 property ID
  timezone: "America/New_York"          # Optional: Property timezone

# GA4 configuration
ga4:
  # Conversion events
  conversions:
    - name: "article_read"              # Event name (lowercase, underscores)
      counting_method: "ONCE_PER_SESSION"  # "ONCE_PER_EVENT" | "ONCE_PER_SESSION"

    - name: "newsletter_subscribe"
      counting_method: "ONCE_PER_EVENT"

  # Custom dimensions
  dimensions:
    - parameter: "user_type"            # Parameter name (lowercase, underscores)
      display_name: "User Type"         # Display name (max 82 chars)
      scope: "USER"                     # "USER" | "EVENT" | "ITEM"

    - parameter: "article_category"
      display_name: "Article Category"
      scope: "EVENT"

  # Custom metrics
  metrics:
    - parameter: "reading_time"         # Parameter name
      display_name: "Reading Time"      # Display name
      scope: "EVENT"                    # "EVENT" only
      unit: "SECONDS"                   # "STANDARD" | "CURRENCY" | "SECONDS" | "MILLISECONDS"

    - parameter: "compression_ratio"
      display_name: "Compression Ratio"
      scope: "EVENT"
      unit: "STANDARD"

  # Cleanup configuration (optional)
  cleanup:
    conversions_to_remove:              # Events to archive
      - "old_event_name"
      - "deprecated_conversion"

    dimensions_to_remove:               # Dimensions to archive
      - "old_dimension"

    metrics_to_remove:                  # Metrics to archive
      - "old_metric"

# Google Search Console configuration
gsc:
  sites:
    - url: "sc-domain:example.com"      # Site URL (sc-domain: or https://)
      sitemaps:                         # Sitemap URLs to submit
        - "https://example.com/sitemap.xml"
        - "https://example.com/sitemap-pages.xml"

    - url: "https://subdomain.example.com"
      sitemaps:
        - "https://subdomain.example.com/sitemap.xml"

  # URL monitoring (optional)
  monitor_urls:                         # URLs to monitor for indexing
    - "https://example.com/"
    - "https://example.com/blog/"
    - "https://example.com/products/"
```

### Config Examples

#### Minimal Config

```yaml
project:
  name: "My Site"
  property_id: "513421535"

ga4:
  conversions:
    - name: "purchase"
      counting_method: "ONCE_PER_EVENT"
```

#### Blog Analytics Config

```yaml
project:
  name: "Tech Blog"
  property_id: "513421535"
  timezone: "America/New_York"

ga4:
  conversions:
    - name: "article_read"
      counting_method: "ONCE_PER_SESSION"
    - name: "newsletter_subscribe"
      counting_method: "ONCE_PER_EVENT"
    - name: "code_copy"
      counting_method: "ONCE_PER_EVENT"

  dimensions:
    - parameter: "article_category"
      display_name: "Article Category"
      scope: "EVENT"
    - parameter: "reading_completion"
      display_name: "Reading Completion"
      scope: "EVENT"
    - parameter: "reader_type"
      display_name: "Reader Type"
      scope: "USER"

  metrics:
    - parameter: "reading_time"
      display_name: "Reading Time"
      scope: "EVENT"
      unit: "SECONDS"
    - parameter: "scroll_depth"
      display_name: "Scroll Depth"
      scope: "EVENT"
      unit: "STANDARD"

gsc:
  sites:
    - url: "sc-domain:myblog.com"
      sitemaps:
        - "https://myblog.com/sitemap.xml"

  monitor_urls:
    - "https://myblog.com/"
    - "https://myblog.com/blog/"
```

#### E-commerce Config

```yaml
project:
  name: "Online Store"
  property_id: "513885304"

ga4:
  conversions:
    - name: "purchase"
      counting_method: "ONCE_PER_EVENT"
    - name: "add_to_cart"
      counting_method: "ONCE_PER_EVENT"
    - name: "begin_checkout"
      counting_method: "ONCE_PER_SESSION"

  dimensions:
    - parameter: "product_category"
      display_name: "Product Category"
      scope: "EVENT"
    - parameter: "payment_method"
      display_name: "Payment Method"
      scope: "EVENT"
    - parameter: "customer_type"
      display_name: "Customer Type"
      scope: "USER"

  metrics:
    - parameter: "cart_value"
      display_name: "Cart Value"
      scope: "EVENT"
      unit: "CURRENCY"
    - parameter: "checkout_time"
      display_name: "Checkout Time"
      scope: "EVENT"
      unit: "SECONDS"

gsc:
  sites:
    - url: "https://store.example.com"
      sitemaps:
        - "https://store.example.com/sitemap-products.xml"
        - "https://store.example.com/sitemap-categories.xml"
```

---

## Advanced Configuration

### Multiple Properties

Manage multiple GA4 properties with separate configs:

**Directory structure:**
```
configs/
├── prod-site.yaml          # Production property
├── dev-site.yaml           # Development property
└── personal-blog.yaml      # Different property
```

**Switch between them:**
```typescript
// Production
ga4_setup({ "config_path": "configs/prod-site.yaml" })

// Development
ga4_setup({ "config_path": "configs/dev-site.yaml" })
```

### Config Validation

Always validate before applying:

```typescript
// 1. Validate config
ga4_validate({
  "config_file": "configs/my-site.yaml",
  "verbose": true
})

// 2. Dry-run setup
ga4_setup({
  "config_path": "configs/my-site.yaml",
  "dry_run": true
})

// 3. Apply setup
ga4_setup({
  "config_path": "configs/my-site.yaml"
})
```

### Workspace Configs

Share configs across team using Git:

```bash
git clone https://github.com/yourorg/analytics-configs
cd analytics-configs

# Create symlink to ga4-manager configs
ln -s $(pwd)/configs /path/to/ga4-manager/configs
```

**Team member setup:**
```json
{
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "~/.config/gcloud/analytics.json",
    "GA4_CONFIG_DIR": "/path/to/analytics-configs/configs"
  }
}
```

### CI/CD Integration

Use in GitHub Actions or CI pipelines:

```yaml
# .github/workflows/analytics.yml
name: Update GA4

on:
  push:
    paths:
      - 'configs/**/*.yaml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd mcp
          npm ci
          npm run build

      - name: Validate config
        run: ./ga4 validate --all --verbose
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_CREDENTIALS }}

      - name: Apply setup
        run: ./ga4 setup --all
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_CREDENTIALS }}
```

---

## Troubleshooting

### Config Not Found

**Error:** `Config file not found: configs/my-site.yaml`

**Fix:**
- Use absolute paths: `/Users/you/ga4-manager/configs/my-site.yaml`
- Or set `GA4_CONFIG_DIR` environment variable

### Property ID Conflicts

**Error:** `Property ID mismatch`

**Fix:**
- Ensure `GA4_DEFAULT_PROPERTY_ID` matches config file `property_id`
- Or remove `GA4_DEFAULT_PROPERTY_ID` to use config file values only

### Permission Denied

**Error:** `Permission denied: /path/to/credentials.json`

**Fix:**
```bash
chmod 600 /path/to/credentials.json
```

### Tool Not Found

**Error:** `Tool not registered: ga4_setup`

**Fix:**
- Rebuild MCP server: `npm run build`
- Restart client (Claude Desktop, VS Code, etc.)
- Check server logs for errors

---

## Best Practices

1. **Use version control** for YAML configs
2. **Validate before applying** with `ga4_validate`
3. **Always use dry-run first** with `dry_run: true`
4. **Set default property IDs** for convenience
5. **Keep credentials secure** (never commit to Git)
6. **Use separate configs** for prod/dev/staging
7. **Monitor quota usage** in GSC responses
8. **Document custom dimensions** in config comments

---

## References

- [Main README](./README.md) - Tool documentation and examples
- [CHANGELOG](./CHANGELOG.md) - Version history
- [GA4 Admin API](https://developers.google.com/analytics/devguides/config/admin/v1)
- [Search Console API](https://developers.google.com/webmaster-tools/v1)
- [MCP Specification](https://modelcontextprotocol.io)
