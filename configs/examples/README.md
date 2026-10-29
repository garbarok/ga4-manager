# GA4 Manager Configuration Examples

This directory contains example YAML configuration files for GA4 Manager, demonstrating how to define conversion events, custom dimensions, metrics, and other GA4 settings for different project types.

## Available Examples

### E-commerce Projects
- **basic-ecommerce.yaml** - Standard e-commerce tracking setup (product views, add-to-cart, purchases)
- **advanced-ecommerce.yaml** - Advanced e-commerce with upsells, subscriptions, and customer lifetime value

### Content Sites
- **content-site.yaml** - Blog/content website tracking (article reads, engagement, social shares)
- **documentation-site.yaml** - Technical documentation site (search usage, code copy, navigation patterns)

### Application Projects
- **saas-app.yaml** - SaaS application tracking (feature usage, conversion funnels, user onboarding)
- **mobile-app.yaml** - Mobile app analytics (app installs, in-app events, screen tracking)

### Marketing Projects
- **lead-generation.yaml** - Lead generation focus (form submissions, email signups, demo requests)
- **affiliate-site.yaml** - Affiliate marketing tracking (click-outs, conversion attribution, revenue)

## Quick Start

### 1. Choose an Example

Select the example that best matches your project type:

```bash
# List available examples
ls -l configs/examples/*.yaml

# View example content
cat configs/examples/basic-ecommerce.yaml
```

### 2. Create Your Configuration

Copy and customize an example:

```bash
# Copy example to your configs directory
cp configs/examples/basic-ecommerce.yaml configs/my-ecommerce.yaml

# Edit with your favorite editor
vim configs/my-ecommerce.yaml
```

### 3. Preview Changes

Always preview before applying:

```bash
# Dry-run to see what will be created
./ga4 setup --config configs/my-ecommerce.yaml --dry-run

# View configuration report
./ga4 report --config configs/my-ecommerce.yaml
```

### 4. Apply Configuration

Once you're satisfied with the preview:

```bash
# Apply to your GA4 property
./ga4 setup --config configs/my-ecommerce.yaml

# Monitor for errors
echo "Exit code: $?"
```

## Configuration File Structure

Each YAML configuration file follows this complete structure:

```yaml
#------------------------------------------------------------------------------
# PROJECT METADATA
#------------------------------------------------------------------------------
project:
  name: string              # Project name (human-readable)
  description: string       # What this project tracks
  version: string           # Config version (e.g., "1.0.0")
  tracking_id: string       # Optional: Google Tag Manager ID
  website_url: string       # Optional: Primary website URL

#------------------------------------------------------------------------------
# GA4 PROPERTY SETTINGS
#------------------------------------------------------------------------------
ga4:
  property_id: string       # GA4 Property ID (numbers only, e.g., "123456789")
  tier: string              # "standard" (free) or "360" (paid)
  timezone: string          # Optional: Property timezone (e.g., "America/Los_Angeles")
  currency: string          # Optional: Default currency (e.g., "USD")

#------------------------------------------------------------------------------
# CONVERSION EVENTS
#------------------------------------------------------------------------------
conversions:
  - name: string                    # Event name (alphanumeric + underscore)
    counting_method: string         # "ONCE_PER_SESSION" or "ONCE_PER_EVENT"
    description: string             # What this conversion tracks
    priority: string                # "high", "medium", or "low"
    category: string                # Optional: Group related conversions

# Counting method examples:
#   ONCE_PER_SESSION - Count once per session (e.g., "session_start", "purchase")
#   ONCE_PER_EVENT - Count every occurrence (e.g., "add_to_cart", "page_view")

#------------------------------------------------------------------------------
# CUSTOM DIMENSIONS
#------------------------------------------------------------------------------
dimensions:
  - parameter: string               # Parameter name sent in tracking code
    display_name: string            # Display name in GA4 UI
    description: string             # What this dimension captures
    scope: string                   # "USER", "EVENT", or "ITEM"
    priority: string                # "high", "medium", or "low"
    examples: []                    # Optional: Example values

# Scope examples:
#   USER - User-level (e.g., "user_type", "subscription_tier")
#   EVENT - Event-level (e.g., "page_category", "button_clicked")
#   ITEM - Item-level for e-commerce (e.g., "product_category", "brand")

#------------------------------------------------------------------------------
# CUSTOM METRICS
#------------------------------------------------------------------------------
metrics:
  - parameter: string               # Parameter name sent in tracking code
    display_name: string            # Display name in GA4 UI
    description: string             # What this metric measures
    unit: string                    # Measurement unit (see below)
    scope: string                   # "EVENT" (most common)
    priority: string                # "high", "medium", or "low"
    restricted_metric_type: []      # Optional: Special metric types

# Measurement units:
#   STANDARD - Generic numeric value (e.g., count, rating)
#   CURRENCY - Monetary value in property currency
#   SECONDS - Time duration in seconds
#   MILLISECONDS - Time duration in milliseconds
#   MINUTES - Time duration in minutes
#   HOURS - Time duration in hours
#   FEET - Distance in feet
#   METERS - Distance in meters
#   KILOMETERS - Distance in kilometers
#   MILES - Distance in miles

#------------------------------------------------------------------------------
# CALCULATED METRICS
#------------------------------------------------------------------------------
calculated_metrics:
  - name: string                    # Metric name
    display_name: string            # Display name in GA4 UI
    description: string             # What this metric calculates
    formula: string                 # Calculation formula
    metric_unit: string             # Result unit

# Formula examples:
#   "{{total_revenue}} / {{sessions}}" - Revenue per session
#   "{{conversions}} / {{users}}" - Conversion rate
#   "{{event_count}} / {{total_users}}" - Events per user

#------------------------------------------------------------------------------
# AUDIENCES (Manual Setup Only)
#------------------------------------------------------------------------------
audiences:
  - name: string                    # Audience name
    description: string             # What this audience represents
    duration: number                # Membership duration in days (1-540)
    conditions: []                  # List of condition descriptions (for manual setup)
    priority: string                # Optional: "high", "medium", or "low"

# Note: Audiences cannot be created via API and must be configured manually
# The tool generates comprehensive setup documentation

#------------------------------------------------------------------------------
# CLEANUP CONFIGURATION
#------------------------------------------------------------------------------
cleanup:
  conversions_to_remove: []         # List of event names to delete
  dimensions_to_remove: []          # List of parameter names to archive
  metrics_to_remove: []             # List of metric parameter names to archive
  reason: string                    # Explanation for cleanup

# Cleanup use cases:
#   - Remove events not implemented in tracking code
#   - Archive dimensions no longer needed
#   - Free up quota when approaching tier limits
#   - Reduce noise in GA4 reports

#------------------------------------------------------------------------------
# DATA RETENTION SETTINGS
#------------------------------------------------------------------------------
data_retention:
  event_data_retention: string      # "TWO_MONTHS" or "FOURTEEN_MONTHS"
  reset_user_data_on_new_activity: boolean  # Reset retention on user activity

# Retention options:
#   TWO_MONTHS - Default for free tier
#   FOURTEEN_MONTHS - Available for all properties
#   FIFTY_MONTHS - GA4 360 only

#------------------------------------------------------------------------------
# ENHANCED MEASUREMENT
#------------------------------------------------------------------------------
enhanced_measurement:
  page_views: boolean               # Auto-track page views
  scrolls: boolean                  # Track 90% scroll depth
  outbound_clicks: boolean          # Track clicks to external sites
  site_search: boolean              # Track internal search queries
  video_engagement: boolean         # Track YouTube video plays
  file_downloads: boolean           # Track PDF/ZIP/etc downloads
  page_changes: boolean             # Track SPA route changes
  form_interactions: boolean        # Track form starts/submits

# Recommendation: Enable all for comprehensive tracking
```

## Field Reference

### Priority Levels

Use priorities to manage GA4 tier limits:

#### GA4 Standard (Free Tier)
- 30 conversions maximum
- 50 custom dimensions maximum
- 50 custom metrics maximum

#### GA4 360 (Paid Tier)
- 50 conversions maximum
- 125 custom dimensions maximum
- 125 custom metrics maximum

#### Priority Guidelines
- **high** - Essential for business decisions, always keep
- **medium** - Useful for optimization, keep if quota available
- **low** - Nice-to-have, can be removed if hitting limits

### Naming Conventions

Follow GA4 naming rules to avoid validation errors:

#### Event Names (Conversions)
- Start with a letter
- Use lowercase letters, numbers, and underscores only
- Maximum 40 characters
- Avoid reserved prefixes: `google_`, `ga_`, `firebase_`

Examples:
- ✅ `add_to_cart`, `purchase_complete`, `form_submit`
- ❌ `2nd_click`, `add-to-cart`, `google_conversion`

#### Parameter Names (Dimensions/Metrics)
- Same rules as event names
- Must match tracking implementation exactly
- Case-sensitive

Examples:
- ✅ `user_type`, `page_category`, `product_price`
- ❌ `User Type`, `page-category`, `ga_source`

#### Display Names
- Maximum 82 characters
- Can contain spaces and special characters
- Shown in GA4 UI

Examples:
- ✅ "User Type", "Page Category", "Product Price (USD)"

### Scope Selection Guide

Choose the right scope for your dimensions:

#### USER Scope
Best for user attributes that don't change frequently:
- User type (free, premium, admin)
- Subscription tier
- First traffic source
- Geographic location
- Language preference

#### EVENT Scope
Best for attributes specific to each event:
- Page path/title
- Button clicked
- Product category
- Form field name
- Error message

#### ITEM Scope
Best for e-commerce item attributes:
- Product name/ID
- Product category
- Brand
- Variant (size, color)
- Price

## Usage Examples

### E-commerce Setup

```bash
# Setup basic e-commerce tracking
./ga4 setup --config configs/examples/basic-ecommerce.yaml --dry-run

# Review what will be created
./ga4 report --config configs/examples/basic-ecommerce.yaml

# Apply configuration
./ga4 setup --config configs/examples/basic-ecommerce.yaml
```

### Content Site Setup

```bash
# Setup blog/content tracking
./ga4 setup --config configs/examples/content-site.yaml --dry-run

# Apply only high-priority items
./ga4 setup --config configs/examples/content-site.yaml --priority high

# Generate audience documentation
./ga4 setup --config configs/examples/content-site.yaml --audiences-only
```

### Cleanup Unused Items

```bash
# Preview cleanup
./ga4 cleanup --config configs/examples/my-project.yaml --dry-run

# Remove unused conversions
./ga4 cleanup --config configs/examples/my-project.yaml --type conversions

# Remove all unused items
./ga4 cleanup --config configs/examples/my-project.yaml --type all --yes
```

### Validate Configuration

```bash
# Check for errors before applying
./ga4 validate --config configs/my-project.yaml

# Validate against tier limits
./ga4 validate --config configs/my-project.yaml --check-limits

# Validate parameter naming
./ga4 validate --config configs/my-project.yaml --check-names
```

## Best Practices

### 1. Start Small, Expand Gradually

Don't configure everything at once:

```yaml
# Start with essential conversions
conversions:
  - name: purchase              # High priority
    counting_method: ONCE_PER_SESSION
    priority: high
  - name: add_to_cart          # Medium priority
    counting_method: ONCE_PER_EVENT
    priority: medium

# Add more as you validate tracking
```

### 2. Match Tracking Implementation

Ensure parameter names exactly match your tracking code:

```javascript
// Tracking code
gtag('event', 'purchase', {
  user_type: 'premium',      // Must match dimension parameter
  purchase_value: 99.99      // Must match metric parameter
});
```

```yaml
# Configuration
dimensions:
  - parameter: user_type     # Exact match required
    display_name: "User Type"
    scope: USER

metrics:
  - parameter: purchase_value  # Exact match required
    display_name: "Purchase Value"
    unit: CURRENCY
```

### 3. Document Everything

Use description fields extensively:

```yaml
dimensions:
  - parameter: user_journey_stage
    display_name: "User Journey Stage"
    description: "Where user is in onboarding: new, active, engaged, churned"
    scope: USER
    priority: high
    examples:
      - "new"
      - "active"
      - "engaged"
      - "churned"
```

### 4. Version Control Your Configs

Track changes over time:

```bash
# Initialize git if not already done
git init
git add configs/

# Commit configuration changes
git commit -m "Add e-commerce tracking configuration"

# Tag releases
git tag -a v1.0.0 -m "Initial GA4 configuration"
```

### 5. Always Test with Dry-Run

Preview changes before applying:

```bash
# Dry-run shows what WOULD happen
./ga4 setup --config configs/my-project.yaml --dry-run

# Review output carefully
# Look for: property ID, event names, parameter names

# Apply only when confident
./ga4 setup --config configs/my-project.yaml
```

### 6. Use Categories for Organization

Group related items:

```yaml
conversions:
  - name: add_to_cart
    category: ecommerce
  - name: begin_checkout
    category: ecommerce
  - name: purchase
    category: ecommerce
  - name: newsletter_signup
    category: engagement
  - name: contact_form_submit
    category: engagement
```

### 7. Respect Tier Limits

Monitor quota usage:

```bash
# Check current usage against limits
./ga4 report --config configs/my-project.yaml --show-limits

# Output:
# Conversions: 12/30 (40% used)
# Dimensions: 23/50 (46% used)
# Metrics: 8/50 (16% used)
```

### 8. Regular Cleanup

Maintain a clean configuration:

```yaml
# Quarterly review: identify unused items
cleanup:
  conversions_to_remove:
    - old_event_name
    - deprecated_conversion
  dimensions_to_remove:
    - unused_parameter
  reason: "Q1 2024 cleanup - removed unused tracking from legacy implementation"
```

## Troubleshooting

### Configuration Not Loading

**Problem**: Config file not found or not loading

```bash
# Verify file exists
ls -l configs/my-project.yaml

# Check YAML syntax
./ga4 validate --config configs/my-project.yaml
```

### Property ID Errors

**Problem**: Invalid property ID format

```yaml
# ❌ Wrong - includes "properties/" prefix
ga4:
  property_id: "properties/123456789"

# ✅ Correct - numbers only
ga4:
  property_id: "123456789"
```

### Validation Failures

**Problem**: Event/parameter name validation errors

```yaml
# ❌ Wrong - starts with number
conversions:
  - name: 2nd_click

# ✅ Correct - starts with letter
conversions:
  - name: second_click
```

### Tier Limit Exceeded

**Problem**: Too many items for GA4 tier

```bash
# Use priorities to filter
./ga4 setup --config configs/my-project.yaml --priority high

# Or manually reduce in config
# Remove low-priority items
```

### Parameter Mismatch

**Problem**: Dimensions not collecting data

**Solution**: Ensure tracking code matches config:

```javascript
// Tracking code parameter name
gtag('event', 'page_view', {
  pageCategory: 'blog'  // ❌ Wrong case
});
```

```yaml
# Config expects exact match
dimensions:
  - parameter: page_category  # ❌ Won't match
```

**Fix**:
```javascript
gtag('event', 'page_view', {
  page_category: 'blog'  // ✅ Correct
});
```

## Migration from Hardcoded Configurations

If migrating from `internal/config/projects.go`:

### Step 1: Export Current Configuration

```bash
# Export existing project to YAML
./ga4 export --project my-legacy-project > configs/my-project.yaml
```

### Step 2: Review and Customize

```bash
# Review generated configuration
cat configs/my-project.yaml

# Edit as needed
vim configs/my-project.yaml
```

### Step 3: Test New Configuration

```bash
# Test with dry-run
./ga4 setup --config configs/my-project.yaml --dry-run

# Compare with legacy config
./ga4 report --project my-legacy-project
./ga4 report --config configs/my-project.yaml
```

### Step 4: Switch to YAML

```bash
# Use YAML config going forward
./ga4 setup --config configs/my-project.yaml
./ga4 cleanup --config configs/my-project.yaml
./ga4 link --config configs/my-project.yaml
```

## Advanced Patterns

### Multi-Environment Setup

Manage different environments:

```bash
# configs/production.yaml
ga4:
  property_id: "123456789"
  tier: "360"

# configs/staging.yaml
ga4:
  property_id: "987654321"
  tier: "standard"

# Deploy to specific environment
./ga4 setup --config configs/production.yaml
./ga4 setup --config configs/staging.yaml
```

### Shared Dimensions Across Projects

Create reusable dimension sets:

```yaml
# configs/shared/common-dimensions.yaml
dimensions:
  - parameter: user_type
    display_name: "User Type"
    scope: USER
  - parameter: page_category
    display_name: "Page Category"
    scope: EVENT

# Reference in main config (manual merge for now)
```

### Incremental Updates

Update specific sections:

```bash
# Add only new conversions
./ga4 setup --config configs/my-project.yaml --conversions-only

# Add only new dimensions
./ga4 setup --config configs/my-project.yaml --dimensions-only

# Add only new metrics
./ga4 setup --config configs/my-project.yaml --metrics-only
```

## Configuration Examples Repository

Find more examples at:

- [configs/examples/basic-ecommerce.yaml](basic-ecommerce.yaml)
- [configs/examples/content-site.yaml](content-site.yaml)
- [configs/examples/saas-app.yaml](saas-app.yaml)
- [configs/examples/lead-generation.yaml](lead-generation.yaml)

## Getting Help

### Command Line Help

```bash
# General help
./ga4 --help

# Command-specific help
./ga4 setup --help
./ga4 cleanup --help
./ga4 validate --help
```

### Documentation

- [Main README](../../README.md) - Feature overview and quick start
- [INSTALL.md](../../INSTALL.md) - Installation instructions
- [SECURITY.md](../../SECURITY.md) - Security best practices
- [CLAUDE.md](../../CLAUDE.md) - Development documentation

### Community Support

- [GitHub Issues](https://github.com/garbarok/ga4-manager/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/garbarok/ga4-manager/discussions) - Questions and community help

## Contributing Examples

Have a useful configuration to share? Submit a pull request!

1. Create your example in `configs/examples/`
2. Follow naming convention: `{project-type}.yaml`
3. Include comprehensive descriptions
4. Test with `--dry-run` before submitting
5. Update this README with your example

## License

Configuration examples are provided as-is for reference and customization.
