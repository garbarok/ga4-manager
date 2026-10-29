# GA4 Tier Limits - Quick Reference

## TL;DR

```yaml
ga4:
  tier: standard  # FREE: 50 dims, 50 metrics, 30 conversions
  # tier: 360     # PAID: 125 dims, 125 metrics, 50 conversions
```

---

## Limits Table

| Resource | Standard (Free) | GA4 360 (Paid) |
|----------|----------------|----------------|
| **Custom Dimensions** | 50 | 125 |
| **Custom Metrics** | 50 | 125 |
| **Conversion Events** | 30 | 50 |
| **Audiences** | 100 | 400 |
| **Data Streams** | 50 | 200 |

---

## Common Errors

### "Maximum resource limit"
```
✗ Error: This resource could not be created because it is already at the maximum resource limit
```

**Fix:** You have too many items. Either:
1. Remove low-priority items from config
2. Cleanup unused items: `./ga4 cleanup --config your-config.yaml`
3. Upgrade to GA4 360

---

### "Reserved parameter"
```
✗ Error: session_id is a reserved parameter_name and cannot be used
```

**Fix:** Don't use these parameter names:
- `session_id` → use `funnel_session_id`
- `user_id` → use `custom_user_id`
- `ga_session_id` → use `tracking_session_id`

[Full list in ERRORS_AND_FAQ.md](./ERRORS_AND_FAQ.md#reserved-parameters)

---

## Priority System

Use `priority` field to auto-limit when hitting tier caps:

```yaml
dimensions:
  # Core - always deploy
  - parameter: user_type
    priority: high

  # Important - deploy if space
  - parameter: utm_source
    priority: medium

  # Nice to have - only if well under limit
  - parameter: test_variant
    priority: low
```

---

## Validation

**Before deploying:**
```bash
./ga4 validate configs/your-project.yaml --verbose
```

**Output shows:**
```
✓ Checking tier limits... OK
  ℹ Configuration Summary:
    Tier: GA4 Standard (Free)
    Conversions: 8 / 30 limit ✓
    Dimensions: 45 / 50 limit ✓
    Metrics: 25 / 50 limit ✓
```

**If over limit:**
```
⚠ Checking tier limits... WARNINGS
  ⚠ Config has 60 dimensions but standard tier limit is 50
```

---

## Recommended Allocation

### Standard Tier (50 dimensions)

**Breakdown:**
- **Core Business** (20 dims): Product, user, transaction data
- **Marketing** (10 dims): UTM params, campaigns, sources
- **Technical** (10 dims): Performance, errors, CWV
- **Behavioral** (5 dims): Engagement, funnel, testing
- **Buffer** (5 dims): Future expansion

### GA4 360 (125 dimensions)

**Breakdown:**
- **Core Business** (40 dims)
- **Marketing** (25 dims)
- **Technical** (20 dims)
- **Behavioral** (15 dims)
- **Advanced** (15 dims): Experiments, ML features
- **Buffer** (10 dims)

---

## Quick Checks

### Am I at the limit?
```bash
./ga4 report --config configs/your-project.yaml
```

Look for:
```
Custom Dimensions (45/50)  ✓ Safe
Custom Metrics (48/50)     ⚠ Near limit
Conversions (28/30)        ⚠ Near limit
```

### What can I remove?
```bash
./ga4 cleanup --config configs/your-project.yaml --dry-run
```

Shows unused items that can be archived.

---

## Cleanup Process

```bash
# 1. Check what's unused
./ga4 cleanup --config configs/your-project.yaml --dry-run

# 2. Archive unused items
./ga4 cleanup --config configs/your-project.yaml

# 3. Verify space freed
./ga4 report --config configs/your-project.yaml
```

**Note:** Archived items:
- ✓ Don't count toward limits
- ✓ Historical data preserved
- ✗ Can't be used for new data
- ✗ Don't appear in reports

---

## Upgrade to GA4 360

**When to upgrade:**
- Need > 50 dimensions
- Need > 50 metrics
- Need > 30 conversions
- Need BigQuery streaming
- Need data freshness < 24 hours
- Need subproperties/roll-ups

**Cost:** ~$150,000/year (contact Google Sales)

**How:** Contact Google Analytics sales team

---

## Reserved Parameters

**Cannot use these as custom dimensions:**

```
session_id              ga_session_id
user_id                 ga_session_number
firebase_screen         engagement_time_msec
firebase_screen_class
```

**Use these instead:**

```
funnel_session_id       tracking_session_id
custom_user_id          session_count
page_identifier         time_engaged_ms
view_name
```

---

## Examples

### Standard Tier Config (Under Limit)

```yaml
project:
  name: My App

ga4:
  property_id: "123456789"
  tier: standard

# 8 conversions (under 30 limit) ✓
conversions:
  - name: purchase
  - name: signup
  # ... 6 more

# 45 dimensions (under 50 limit) ✓
dimensions:
  - parameter: user_type
    priority: high
  # ... 44 more with priorities

# 40 metrics (under 50 limit) ✓
metrics:
  - parameter: cart_value
  # ... 39 more
```

### GA4 360 Config (Higher Limits)

```yaml
ga4:
  property_id: "123456789"
  tier: "360"

# Can have up to:
# - 50 conversions
# - 125 dimensions
# - 125 metrics
```

---

## Tools

### Validate Config
```bash
./ga4 validate configs/your-project.yaml --verbose
```

### Deploy Config
```bash
./ga4 setup --config configs/your-project.yaml
```

### Check Status
```bash
./ga4 report --config configs/your-project.yaml
```

### Clean Up
```bash
./ga4 cleanup --config configs/your-project.yaml
```

---

## Need Help?

- **Full Error Guide**: [ERRORS_AND_FAQ.md](./ERRORS_AND_FAQ.md)
- **Config Guide**: [../configs/README.md](../configs/README.md)
- **GA4 Docs**: https://support.google.com/analytics/answer/9267744
