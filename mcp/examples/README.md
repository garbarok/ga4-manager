# GA4 Manager Configuration Examples

Ready-to-use configuration templates for common use cases.

## Quick Start

1. **Choose a template** that matches your use case
2. **Copy to your configs directory**:
   ```bash
   cp examples/blog.yaml ../configs/my-site.yaml
   ```
3. **Update the property ID**:
   ```yaml
   project:
     property_id: "YOUR_PROPERTY_ID"  # Replace with your GA4 property ID
   ```
4. **Validate the config**:
   ```bash
   ../ga4 validate --config my-site.yaml --verbose
   ```
5. **Apply with dry-run first**:
   ```bash
   ../ga4 setup --config my-site.yaml --dry-run
   ```

## Available Templates

### 1. Minimal (`minimal.yaml`)

**Use for:** Quick start, learning the tool, minimal tracking setup

**Includes:**
- 2 conversions (purchase, sign_up)
- 1 dimension (user_type)
- Basic GSC integration (commented out)

**Best for:**
- New projects
- Testing the tool
- Learning YAML config structure

---

### 2. Blog (`blog.yaml`)

**Use for:** Content sites, blogs, documentation sites, publishing platforms

**Includes:**
- 5 conversions: article_read, newsletter_subscribe, code_copy, article_share, comment_submit
- 5 dimensions: article_category, content_language, reading_completion, reader_type, traffic_source_type
- 3 metrics: reading_time, scroll_depth, word_count
- GSC with sitemap monitoring

**Best for:**
- Technical blogs
- Content marketing sites
- Documentation platforms
- Publishing platforms

---

### 3. E-commerce (`ecommerce.yaml`)

**Use for:** Online stores, product sites, marketplaces

**Includes:**
- 7 conversions: purchase, add_to_cart, begin_checkout, add_payment_info, add_shipping_info, view_item, search
- 6 dimensions: product_category, product_brand, payment_method, shipping_method, customer_type, discount_code_used
- 4 metrics: cart_value, shipping_cost, checkout_time, product_views
- GSC for product pages

**Best for:**
- E-commerce stores
- Product catalogs
- Marketplaces
- Retail sites

---

### 4. SaaS (`saas.yaml`)

**Use for:** Web applications, SaaS products, subscription services

**Includes:**
- 6 conversions: sign_up, trial_start, subscription_purchase, feature_used, upgrade_click, support_ticket
- 5 dimensions: subscription_plan, feature_name, user_role, account_age, trial_status
- 3 metrics: session_duration, features_used, monthly_revenue
- GSC for marketing site

**Best for:**
- SaaS products
- Web applications
- Subscription services
- Freemium products

---

## Customization Guide

### Adding Conversions

```yaml
ga4:
  conversions:
    - name: "your_event_name"        # Lowercase, underscores only
      counting_method: "ONCE_PER_EVENT"  # or "ONCE_PER_SESSION"
```

**Counting methods:**
- `ONCE_PER_EVENT`: Count every occurrence (clicks, views, submissions)
- `ONCE_PER_SESSION`: Count once per session (sign-ups, purchases)

### Adding Dimensions

```yaml
ga4:
  dimensions:
    - parameter: "your_parameter"    # Parameter sent with event
      display_name: "Your Parameter" # Name shown in GA4 UI
      scope: "EVENT"                 # EVENT, USER, or ITEM
```

**Scopes:**
- `EVENT`: Different per event (article_category, button_id)
- `USER`: Same across user's session (user_type, subscription_plan)
- `ITEM`: For e-commerce items only

### Adding Metrics

```yaml
ga4:
  metrics:
    - parameter: "your_metric"
      display_name: "Your Metric"
      scope: "EVENT"                 # EVENT only
      unit: "STANDARD"               # STANDARD, CURRENCY, SECONDS, MILLISECONDS
```

**Units:**
- `STANDARD`: Regular numbers (count, score, rating)
- `CURRENCY`: Money values (revenue, cost)
- `SECONDS`: Time in seconds (duration, delay)
- `MILLISECONDS`: Time in milliseconds (page load, response time)

### Adding GSC Sites

```yaml
gsc:
  sites:
    - url: "sc-domain:example.com"   # Domain property
      sitemaps:
        - "https://example.com/sitemap.xml"

    - url: "https://blog.example.com" # URL-prefix property
      sitemaps:
        - "https://blog.example.com/sitemap.xml"
```

### Adding URL Monitoring

```yaml
gsc:
  monitor_urls:
    - "https://example.com/"
    - "https://example.com/important-page/"
```

## Cleanup Configuration

Remove unused tracking after code changes:

```yaml
ga4:
  cleanup:
    conversions_to_remove:
      - "old_event_name"
      - "deprecated_conversion"

    dimensions_to_remove:
      - "old_dimension_param"

    metrics_to_remove:
      - "old_metric_param"
```

Then run:
```bash
../ga4 cleanup --config my-site.yaml --dry-run
```

## Multi-Environment Setup

### Production

```yaml
# configs/prod.yaml
project:
  name: "My Site (Production)"
  property_id: "513421535"
```

### Development

```yaml
# configs/dev.yaml
project:
  name: "My Site (Development)"
  property_id: "513885304"
```

### Usage

```bash
# Setup production
../ga4 setup --config prod.yaml

# Setup development
../ga4 setup --config dev.yaml
```

## Validation Checklist

Before applying your config:

- [ ] Property ID is correct
- [ ] Event names are lowercase with underscores
- [ ] Parameter names match your tracking code
- [ ] Scopes are appropriate (EVENT vs USER)
- [ ] Metric units are correct
- [ ] GSC site URLs match Search Console
- [ ] Sitemap URLs are accessible
- [ ] Config passes validation: `../ga4 validate --config my-site.yaml --verbose`
- [ ] Dry-run looks correct: `../ga4 setup --config my-site.yaml --dry-run`

## Common Patterns

### Newsletter Tracking

```yaml
conversions:
  - name: "newsletter_subscribe"
    counting_method: "ONCE_PER_EVENT"

dimensions:
  - parameter: "newsletter_source"
    display_name: "Newsletter Source"
    scope: "EVENT"
```

### Content Engagement

```yaml
conversions:
  - name: "content_engagement"
    counting_method: "ONCE_PER_SESSION"

metrics:
  - parameter: "engagement_time"
    display_name: "Engagement Time"
    scope: "EVENT"
    unit: "SECONDS"
```

### Feature Usage

```yaml
conversions:
  - name: "feature_activation"
    counting_method: "ONCE_PER_SESSION"

dimensions:
  - parameter: "feature_id"
    display_name: "Feature ID"
    scope: "EVENT"

  - parameter: "user_plan"
    display_name: "User Plan"
    scope: "USER"
```

## Troubleshooting

### Config Validation Errors

**Error:** `Invalid property ID format`
- Property IDs must be numeric (e.g., "513421535")
- No "GA" prefix or dashes

**Error:** `Reserved prefix detected`
- Don't use `google_`, `ga_`, or `firebase_` prefixes
- Use custom names like `my_event` or `custom_dimension`

**Error:** `Display name too long`
- Display names max 82 characters
- Keep them concise for GA4 UI readability

### Setup Failures

**Error:** `Property not found`
- Verify property ID exists in GA4
- Check credentials have access to this property

**Error:** `Permission denied`
- Ensure credentials have `analytics.edit` permission
- Check you're using the correct service account

## Next Steps

1. Review [CONFIGURATION.md](../CONFIGURATION.md) for client setup
2. Read [README.md](../README.md) for tool documentation
3. Check [CHANGELOG.md](../CHANGELOG.md) for version history

## Support

- **Main README:** [../README.md](../README.md)
- **Configuration Guide:** [../CONFIGURATION.md](../CONFIGURATION.md)
- **Issues:** [GitHub Issues](https://github.com/garbarok/ga4-manager/issues)
