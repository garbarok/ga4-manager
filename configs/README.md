# GA4 Manager Configurations

This directory contains configuration files for Google Analytics 4 properties.

## Quick Start

### 1. Create Your Config

```bash
# Option 1: Copy the template
cp configs/examples/template.yaml configs/my-project.yaml

# Option 2: Use the init command (coming soon)
./ga4 init my-project.yaml
```

### 2. Edit Your Config

Open `configs/my-project.yaml` and fill in:
- Your GA4 Property ID (find in GA4 Admin → Property Settings)
- Conversion events you want to track
- Custom dimensions and metrics
- Any cleanup items (events/dimensions to remove)

### 3. Validate Your Config

```bash
# Validate your config file
./ga4 validate configs/my-project.yaml

# Validate all configs
./ga4 validate --all

# Show detailed validation output
./ga4 validate configs/my-project.yaml --verbose
```

### 4. Deploy Your Config

```bash
# Deploy to GA4
./ga4 setup --config configs/my-project.yaml

# Preview what will be created (dry-run)
./ga4 setup --config configs/my-project.yaml --dry-run
```

## Directory Structure

```
configs/
├── examples/              # Example configurations
│   ├── snapcompress.yaml  # SnapCompress project example
│   ├── personal.yaml      # Personal website example (coming soon)
│   └── template.yaml      # Blank template to copy
├── README.md              # This file
└── your-project.yaml      # Your custom configs go here
```

## Configuration Format

Configs are written in YAML. Here's the structure:

```yaml
# Project Information
project:
  name: My Project
  description: What this project tracks
  version: "1.0"

# GA4 Property Details
ga4:
  property_id: "123456789"    # Required: Your GA4 Property ID
  measurement_id: G-XXXXXXXXX # Optional: Measurement ID
  data_stream_id: ""          # Optional: Auto-detected if not set

# Conversion Events
conversions:
  - name: purchase
    counting_method: ONCE_PER_EVENT  # or ONCE_PER_SESSION
    description: User completed a purchase

# Custom Dimensions
dimensions:
  - parameter: user_tier
    display_name: User Tier
    description: User's subscription level
    scope: EVENT  # or USER

# Custom Metrics
metrics:
  - parameter: cart_value
    display_name: Cart Value
    description: Total value in cart
    unit: CURRENCY  # STANDARD, CURRENCY, SECONDS, etc.
    scope: EVENT

# Cleanup (optional)
cleanup:
  conversions_to_remove:
    - old_event_name
  dimensions_to_remove:
    - old_parameter_name
  reason: Not implemented in tracking code

# Data Retention (optional)
data_retention:
  event_data_retention: TWO_MONTHS
  reset_user_data_on_new_activity: true

# Enhanced Measurement (optional)
enhanced_measurement:
  page_views: true
  scrolls: true
  outbound_clicks: true
  site_search: true
  video_engagement: false
  file_downloads: true
  page_changes: true
  form_interactions: true
```

## Avoiding YAML Errors

YAML is sensitive to indentation. Follow these guidelines:

### ✅ DO:
- Use **2 spaces** for indentation (not tabs)
- Keep indentation consistent
- Quote values with special characters
- Use the `validate` command before deploying

### ❌ DON'T:
- Mix tabs and spaces
- Use inconsistent indentation
- Forget colons after keys
- Deploy without validating

### Tools to Help

**1. Built-in Validator:**
```bash
./ga4 validate configs/my-project.yaml
```

**2. VS Code Extensions:**
- Install "YAML" by Red Hat
- Settings are pre-configured in `.vscode/settings.json`

**3. yamllint (optional):**
```bash
# Install
pip install yamllint

# Run
yamllint configs/

# Or use our script
./scripts/format-yaml.sh
```

## Common Configuration Patterns

### E-commerce Site

```yaml
conversions:
  - name: purchase
    counting_method: ONCE_PER_EVENT
  - name: add_to_cart
    counting_method: ONCE_PER_EVENT
  - name: begin_checkout
    counting_method: ONCE_PER_SESSION

dimensions:
  - parameter: product_category
    display_name: Product Category
    scope: EVENT
  - parameter: user_tier
    display_name: User Tier
    scope: USER

metrics:
  - parameter: cart_value
    display_name: Cart Value
    unit: CURRENCY
    scope: EVENT
```

### SaaS/Content Site

```yaml
conversions:
  - name: signup
    counting_method: ONCE_PER_SESSION
  - name: trial_start
    counting_method: ONCE_PER_SESSION
  - name: article_read
    counting_method: ONCE_PER_EVENT

dimensions:
  - parameter: article_category
    display_name: Article Category
    scope: EVENT
  - parameter: subscription_plan
    display_name: Subscription Plan
    scope: USER

metrics:
  - parameter: reading_time
    display_name: Reading Time
    unit: SECONDS
    scope: EVENT
```

### Tool/App Site

```yaml
conversions:
  - name: tool_used
    counting_method: ONCE_PER_EVENT
  - name: export_completed
    counting_method: ONCE_PER_EVENT
  - name: share_result
    counting_method: ONCE_PER_EVENT

dimensions:
  - parameter: tool_type
    display_name: Tool Type
    scope: EVENT
  - parameter: export_format
    display_name: Export Format
    scope: EVENT

metrics:
  - parameter: processing_time
    display_name: Processing Time
    unit: SECONDS
    scope: EVENT
  - parameter: file_size
    display_name: File Size
    unit: STANDARD
    scope: EVENT
```

## Reference

### Counting Methods
- `ONCE_PER_EVENT` - Count every occurrence
- `ONCE_PER_SESSION` - Count once per session

### Dimension Scopes
- `EVENT` - Associated with specific events
- `USER` - Associated with the user across sessions

### Metric Units
- `STANDARD` - Regular numeric value
- `CURRENCY` - Monetary value
- `SECONDS`, `MINUTES`, `HOURS` - Time durations
- `METERS`, `KILOMETERS`, `FEET`, `MILES` - Distances

### Data Retention Periods
- `TWO_MONTHS` - 2 months (default)
- `FOURTEEN_MONTHS` - 14 months
- `TWENTY_SIX_MONTHS` - 26 months
- `THIRTY_EIGHT_MONTHS` - 38 months
- `FIFTY_MONTHS` - 50 months

## Getting Help

- **Validation errors?** Run `./ga4 validate configs/your-file.yaml --verbose`
- **YAML syntax help?** See our [YAML tips](#avoiding-yaml-errors)
- **Need examples?** Check `configs/examples/`
- **API errors?** Check your Property ID and credentials

## Next Steps

After creating your config:

1. **Validate** - `./ga4 validate configs/my-project.yaml`
2. **Deploy** - `./ga4 setup --config configs/my-project.yaml`
3. **Verify** - `./ga4 report --config configs/my-project.yaml`
4. **Cleanup** - `./ga4 cleanup --config configs/my-project.yaml --dry-run`

For more information, see the main [README.md](../README.md) or [CLAUDE.md](../CLAUDE.md).
