# GA4 Manager - Errors & FAQ

Complete guide to troubleshooting common errors and questions.

---

## Table of Contents

1. [GA4 Tier Limits](#ga4-tier-limits)
2. [Common Errors](#common-errors)
3. [Reserved Parameters](#reserved-parameters)
4. [FAQ](#faq)
5. [Best Practices](#best-practices)

---

## GA4 Tier Limits

### Understanding GA4 Tiers

Google Analytics 4 has two tiers with different resource limits:

| Resource              | Standard (Free) | GA4 360 (Paid) |
| --------------------- | --------------- | -------------- |
| **Custom Dimensions** | 50              | 125            |
| **Custom Metrics**    | 50              | 125            |
| **Conversion Events** | 30              | 50             |
| **Audiences**         | 100             | 400            |

### Configuring Your Tier

Add the `tier` field to your config:

```yaml
ga4:
  property_id: 'YOUR_PROPERTY_ID'
  tier: standard # or "360" for paid tier
```

If not specified, defaults to `standard` (free tier).

### What Happens When You Hit the Limit?

When you exceed tier limits:

- **API Error**: `This resource could not be created because it is already at the maximum resource limit`
- **Behavior**: Items are created until the limit is reached, then subsequent items fail
- **Solution**: Reduce config items or upgrade to GA4 360

---

## Common Errors

### 1. Resource Limit Errors

**Error Message:**

```
googleapi: Error 400: This resource could not be created because it is already at the maximum resource limit., badRequest
```

**Cause:**

- You have too many dimensions/metrics/conversions for your GA4 tier
- Standard (free): 50 dimensions, 50 metrics, 30 conversions
- GA4 360 (paid): 125 dimensions, 125 metrics, 50 conversions

**Solutions:**

#### Solution A: Prioritize Items (Recommended)

Add `priority` field to your config items:

```yaml
dimensions:
  # High priority - always create
  - parameter: user_type
    display_name: User Type
    priority: high
    scope: USER

  # Medium priority - create if space available
  - parameter: utm_source
    display_name: UTM Source
    priority: medium
    scope: EVENT

  # Low priority - only if well under limit
  - parameter: test_variant
    display_name: Test Variant
    priority: low
    scope: EVENT
```

#### Solution B: Remove Low-Value Items

Identify and remove:

- Redundant dimensions (e.g., browser capabilities you don't use)
- Detailed error tracking dimensions (use Sentry instead)
- A/B test dimensions if not running tests
- Unused SEO dimensions

#### Solution C: Cleanup Existing Items

Free up space by removing unused items:

```bash
# Check what's configured
./ga4 report --config configs/your-project.yaml

# Cleanup unused items
./ga4 cleanup --config configs/your-project.yaml --dry-run
./ga4 cleanup --config configs/your-project.yaml
```

#### Solution D: Upgrade to GA4 360

Contact Google to upgrade:

- 125 custom dimensions (up from 50)
- 125 custom metrics (up from 50)
- 50 conversions (up from 30)
- Advanced features

---

### 2. Reserved Parameter Errors

**Error Message:**

```
googleapi: Error 400: session_id is a reserved parameter_name and cannot be used., badRequest
```

**Cause:**
You're trying to use a parameter name reserved by GA4.

**Reserved Parameters:**

- `session_id`
- `user_id`
- `firebase_screen`
- `firebase_screen_class`
- `ga_session_id`
- `ga_session_number`
- `engagement_time_msec`

**Solution:**
Use alternative parameter names:

```yaml
# ❌ Don't use
- parameter: session_id
  display_name: Session ID

# ✅ Use instead
- parameter: funnel_session_id
  display_name: Funnel Session ID
```

**Validation:**
The `validate` command now catches reserved parameters:

```bash
./ga4 validate configs/your-project.yaml
# Will show: dimensions[X].parameter 'session_id' is reserved by GA4
```

---

### 3. Already Exists Errors

**Error Message:**

```
googleapi: Error 409: Requested entity already exists, alreadyExists
```

**Cause:**
The dimension/metric/conversion was already created in a previous run.

**Behavior:**

- This is **NOT an error** - it means the item exists
- The command continues with remaining items
- No action needed

**When to Worry:**
Only if you expect the item NOT to exist (e.g., after cleanup).

---

### 4. YAML Syntax Errors

**Error Messages:**

```
yaml: line 42: mapping values are not allowed in this context
yaml: line 15: did not find expected key
```

**Common Causes:**

#### Missing Quotes

```yaml
# ❌ Wrong
description: User's preference

# ✅ Correct
description: "User's preference"
```

#### Indentation Errors

```yaml
# ❌ Wrong (mixed tabs/spaces)
dimensions:
	- parameter: test  # Tab here
  - parameter: test2  # Spaces here

# ✅ Correct (consistent 2 spaces)
dimensions:
  - parameter: test
  - parameter: test2
```

#### Special Characters

```yaml
# ❌ Wrong
conditions:
  - Event: test >= 2  # Colon in unquoted string

# ✅ Correct
conditions:
  - "Event: test >= 2"
```

**Solutions:**

1. Use `./ga4 validate` before deploying
2. Install YAML VS Code extension
3. Use 2 spaces (not tabs)
4. Quote strings with special characters

---

### 5. Property Not Found

**Error Message:**

```
googleapi: Error 404: Requested entity was not found., notFound
```

**Causes:**

- Wrong Property ID
- Insufficient permissions
- Property doesn't exist

**Solutions:**

#### Check Property ID

```yaml
ga4:
  property_id: '123456789' # Must be just numbers, no "properties/" prefix
```

Find it in GA4:

1. Go to Admin → Property Settings
2. Copy the Property ID (numbers only)

#### Check Permissions

Ensure your service account has:

- Editor or Administrator role on the property
- OAuth scopes:
  - `https://www.googleapis.com/auth/analytics.edit`
  - `https://www.googleapis.com/auth/analytics.readonly`

#### Verify Credentials

```bash
# Check env file
cat .env | grep GOOGLE_APPLICATION_CREDENTIALS

# Test authentication
./ga4 report --config configs/my-project.yaml
```

---

### 6. Authentication Errors

**Error Message:**

```
failed to create GA4 client: could not find default credentials
```

**Cause:**
Missing or invalid credentials.

**Solution:**

1. **Create Service Account:**

   - Go to Google Cloud Console
   - Create service account
   - Download JSON key

2. **Set Environment Variable:**

   ```bash
   # In .env file
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
   ```

3. **Grant Permissions:**

   - Go to GA4 Admin → Property Access Management
   - Add service account email
   - Grant Editor role

4. **Verify:**
   ```bash
   ./ga4 report --all
   ```

---

## Reserved Parameters

Complete list of parameters you **CANNOT** use as custom dimensions:

| Parameter               | Why Reserved                  |
| ----------------------- | ----------------------------- |
| `session_id`            | GA4 internal session tracking |
| `user_id`               | GA4 user identification       |
| `firebase_screen`       | Firebase integration          |
| `firebase_screen_class` | Firebase integration          |
| `ga_session_id`         | Google Analytics session ID   |
| `ga_session_number`     | Session counter               |
| `engagement_time_msec`  | Automatic engagement tracking |

### Alternative Names

Use these instead:

```yaml
# Session tracking
funnel_session_id, session_identifier, tracking_session

# User tracking
custom_user_id, client_identifier, visitor_id

# Screen tracking
page_name, view_name, screen_identifier
```

---

## FAQ

### Q: How do I know my GA4 tier?

**A:** Check in GA4 Admin → Property Settings. If you don't see "GA4 360" or aren't paying Google, you're on the Standard (free) tier.

Default limits:

- Standard: 50 dimensions, 50 metrics, 30 conversions
- GA4 360: 125 dimensions, 125 metrics, 50 conversions

---

### Q: Can I delete dimensions/metrics to free up space?

**A:** No, GA4 doesn't support deletion. You can only **archive** them:

- Archived items don't count toward limits
- Historical data is preserved
- They don't appear in reports

```bash
./ga4 cleanup --config configs/your-project.yaml
```

---

### Q: What happens to historical data when I archive?

**A:** Historical data is **preserved** but not accessible in standard reports. To access:

- Use BigQuery export
- Use GA4 API to query archived dimensions
- Data is NOT deleted

---

### Q: How do I prioritize dimensions?

**A:** Add `priority` field to your config:

```yaml
dimensions:
  # Core business - always create
  - parameter: file_format
    priority: high
    # ...

  # Nice to have - create if space
  - parameter: utm_source
    priority: medium
    # ...

  # Optional - only if well under limit
  - parameter: test_variant
    priority: low
    # ...
```

Tool will deploy high → medium → low until limit reached.

---

### Q: Can I create audiences via API?

**A:** **No.** GA4 API does not support audience creation due to complex filter logic.

You must create audiences manually in GA4 UI:

1. Go to Admin → Audiences
2. Click "New Audience"
3. Follow the conditions in your config's `audiences` section

The tool provides documentation to guide manual setup.

---

### Q: Why did some metrics fail with "alreadyExists"?

**A:** This is **normal**! It means you ran the setup before and those items already exist. The tool:

- Skips existing items (no error)
- Creates new items
- Reports which were skipped vs created

**Not an error** - your config is fine.

---

### Q: How do I update an existing dimension?

**A:** You cannot change custom dimensions after creation. You can only:

1. Archive the old one
2. Create a new one with a different parameter name
3. Update your tracking code to use the new parameter

**Workaround:**

- Use versioned parameter names: `user_type_v2`
- Keep old parameter collecting data while transitioning

---

### Q: What's the difference between parameter and display_name?

**A:**

- **parameter**: Technical name sent from your code (`user_type`)
- **display_name**: Human-friendly name in GA4 UI ("User Type")

```yaml
- parameter: user_type # Used in tracking code
  display_name: User Type # Shown in reports
```

---

### Q: Can I change tier limits in my config?

**A:** The `tier` field tells the tool YOUR tier, it doesn't change GA4's limits. To increase limits, you must upgrade to GA4 360 through Google.

```yaml
ga4:
  tier: standard # What you HAVE
  # Not: tier: 360  # What you WANT (must purchase from Google)
```

---

### Q: How do I validate before deploying?

**A:**

```bash
# Basic validation
./ga4 validate configs/your-project.yaml

# Detailed validation with tier check
./ga4 validate configs/your-project.yaml --verbose

# Validate all configs
./ga4 validate --all
```

---

### Q: What's the recommended number of dimensions?

**Best Practices:**

- **Standard tier**: Use 40-45 dimensions (leave buffer for future)
- **GA4 360**: Use 100-110 dimensions (leave buffer)
- **Priority distribution**:
  - High: 60% (core business metrics)
  - Medium: 30% (marketing/analytics)
  - Low: 10% (experimental/nice-to-have)

---

### Q: Can I use special characters in parameter names?

**A:** Limited. GA4 parameter names must:

- Start with a letter
- Contain only letters, numbers, underscores
- Be lowercase (recommended)
- Not exceed 40 characters

```yaml
# ✅ Valid
parameter: user_type
parameter: utm_source
parameter: file_format_v2

# ❌ Invalid
parameter: user-type      # No hyphens
parameter: User_Type      # Use lowercase
parameter: user.type      # No periods
parameter: 2fa_enabled    # Can't start with number
```

---

### Q: How do I test without affecting production?

**A:**

1. Create a separate GA4 test property
2. Create a test config file
3. Deploy to test property first

```yaml
# configs/my-test-project.yaml
ga4:
  property_id: 'YOUR_TEST_PROPERTY_ID'
  tier: standard
```

```bash
./ga4 setup --config configs/my-test-project.yaml
```

---

## Best Practices

### 1. Always Validate First

```bash
./ga4 validate configs/your-project.yaml --verbose
```

### 2. Use Priority System

```yaml
dimensions:
  - parameter: core_metric
    priority: high # Business critical

  - parameter: utm_source
    priority: medium # Marketing

  - parameter: experimental_test
    priority: low # Testing only
```

### 3. Stay Under Limits

- **Standard**: Use max 45 dimensions (buffer of 5)
- **GA4 360**: Use max 120 dimensions (buffer of 5)

### 4. Document Your Config

```yaml
# Why we track this
- parameter: file_format
  description: Critical for compression analysis
  priority: high
```

### 5. Version Control

```bash
git add configs/
git commit -m "Updated GA4 config - removed low-priority dimensions"
```

### 6. Test Incremental Changes

```bash
# Don't do:
./ga4 setup --all  # 200 items at once

# Do:
./ga4 setup --config configs/project-1.yaml  # Test one at a time
./ga4 validate configs/project-2.yaml
```

### 7. Monitor Quota Usage

```bash
./ga4 report --config configs/your-project.yaml --verbose
# Shows: Dimensions: 45 / 50 limit
```

### 8. Use Cleanup Regularly

```bash
# Quarterly review
./ga4 cleanup --config configs/your-project.yaml --dry-run
# Archive unused dimensions to free space
```

---

## Getting Help

### Debug Mode

```bash
# Enable verbose output
./ga4 setup --config configs/your-project.yaml --verbose

# Check validation with details
./ga4 validate configs/your-project.yaml --verbose
```

### Report Issues

If you encounter errors not covered here:

1. Run `./ga4 validate` and save output
2. Run failing command with `--verbose`
3. Report at: https://github.com/garbarok/claude-code/issues

### Resources

- **GA4 Limits**: https://support.google.com/analytics/answer/9267744
- **Custom Dimensions Guide**: https://support.google.com/analytics/answer/10075209
- **Service Account Setup**: https://developers.google.com/analytics/devguides/config/admin/v1/quickstart-client-libraries
