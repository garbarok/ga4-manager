# GA4 Manager MCP — Permissions Guide

This guide explains how to grant your service account the access it needs for each tool in the GA4 Manager MCP server.

## Table of Contents

- [Service Account Setup](#service-account-setup)
- [Google Search Console (GSC)](#google-search-console-gsc)
- [Google Analytics 4 (GA4)](#google-analytics-4-ga4)
- [PageSpeed Insights (PSI)](#pagespeed-insights-psi)
- [Batch Onboarding](#batch-onboarding)
- [Troubleshooting](#troubleshooting)

---

## Service Account Setup

All tools use the same `GOOGLE_APPLICATION_CREDENTIALS` environment variable — no extra credential setup is required beyond what is documented in [CONFIGURATION.md](./CONFIGURATION.md).

To find the service account email used by the server:

```bash
cat "$GOOGLE_APPLICATION_CREDENTIALS" | grep '"client_email"'
# → "client_email": "ga4-manager@your-project.iam.gserviceaccount.com"
```

You will need this email address to grant access in the sections below.

---

## Google Search Console (GSC)

**Affects tools:** `gsc_traffic_compare`, `gsc_analytics_run`, `gsc_index_coverage`, `gsc_inspect_url`, `gsc_monitor_urls`, `gsc_sitemaps_list`, `gsc_sitemaps_submit`, `gsc_sitemaps_delete`, `gsc_sitemaps_get`

The Search Console API has no programmatic way to manage users — access must be granted through the UI.

### Steps

1. Open [Google Search Console](https://search.google.com/search-console) and select your property.
2. In the left sidebar, click **Settings** (gear icon at the bottom).
3. Under **Users and permissions**, click **Add user**.
4. Enter the service account email (e.g. `ga4-manager@your-project.iam.gserviceaccount.com`).
5. Choose a permission level:
   - **Restricted** — read-only access to traffic data (sufficient for `gsc_traffic_compare`, `gsc_analytics_run`, `gsc_index_coverage`, `gsc_inspect_url`, `gsc_monitor_urls`).
   - **Full** — also allows sitemap management (required for `gsc_sitemaps_submit`, `gsc_sitemaps_delete`).
6. Click **Add**.

Repeat for every Search Console property you want to query.

> **Note:** `sc-domain:example.com` domain properties and `https://example.com` URL-prefix properties are treated as separate properties in Search Console. Grant access to the specific property type your tools reference.

---

## Google Analytics 4 (GA4)

**Affects tools:** `ga4_report`, `ga4_setup`, `ga4_cleanup`, `ga4_validate`, `ga4_link`, `ga4_consent_health`

### Steps

1. Open [Google Analytics](https://analytics.google.com) and select your account and property.
2. In the bottom-left, click **Admin** (gear icon).
3. Under the **Property** column, click **Property access management**.
4. Click the **+** button in the top-right and select **Add users**.
5. Enter the service account email.
6. Assign the **Viewer** role (sufficient for reporting tools and `ga4_consent_health`).
   - Assign **Editor** or higher if using `ga4_setup` or `ga4_cleanup` to make changes.
7. Click **Add**.

Repeat for every GA4 property you want to manage.

> **Tip:** If you manage many properties, use the [Batch Onboarding](#batch-onboarding) script instead of repeating these steps manually.

---

## PageSpeed Insights (PSI)

**Affects tools:** `seo_page_audit` (when `check_cwv: true`)

PageSpeed Insights works without an API key (rate-limited to ~1 request per 100 seconds). An optional API key removes the rate limit.

### Without an API key

No setup needed. The server automatically throttles requests to stay within the free quota. Pass `check_cwv: true` to enable Core Web Vitals data.

### With an API key (optional)

1. Open [Google Cloud Console](https://console.cloud.google.com) and select your project.
2. Navigate to **APIs & Services → Library**.
3. Search for **PageSpeed Insights API** and click **Enable**.
4. Navigate to **APIs & Services → Credentials**.
5. Click **Create Credentials → API key**.
6. Copy the key and restrict it to the PageSpeed Insights API (recommended).
7. Pass the key as `psi_api_key` in `seo_page_audit` calls, or set it in a shared config.

---

## Batch Onboarding

For teams managing many GA4 properties, the optional `provision-ga4-access.ts` script automates granting Viewer access via the GA4 Admin API.

### Prerequisites

- Service account credentials configured via `GOOGLE_APPLICATION_CREDENTIALS`.
- The service account must already have **Editor** or **Admin** access on the account level (not just property level) to grant access to other users, OR you can run the script as a user account with sufficient permissions.
- `tsx` installed globally or locally (`npm install -g tsx`).

### Usage

```bash
# Grant Viewer access to a list of properties
cd mcp
npx tsx scripts/provision-ga4-access.ts \
  --sa-email "ga4-manager@your-project.iam.gserviceaccount.com" \
  123456789 987654321 555444333

# Or read property IDs from a file (one per line)
npx tsx scripts/provision-ga4-access.ts \
  --sa-email "ga4-manager@your-project.iam.gserviceaccount.com" \
  --properties-file properties.txt
```

### Output

```
Granting Viewer access to: ga4-manager@your-project.iam.gserviceaccount.com

  ✓ properties/123456789 — access granted
  ✓ properties/987654321 — access granted
  ✗ properties/555444333 — PERMISSION_DENIED: caller lacks Editor role on this property

Summary: 2 succeeded, 1 failed
```

The script uses `accessBindings.create` from the GA4 Admin API. It reports success or failure per property and exits with a non-zero code if any property failed.

---

## Troubleshooting

### `AUTH_DENIED` Error

When a tool cannot access a resource, it returns:

```json
{
  "success": false,
  "error": {
    "code": "AUTH_DENIED",
    "message": "GSC access denied (HTTP 403)",
    "hint": "Add the service account email as a user in Search Console for this site"
  }
}
```

**Common causes and fixes:**

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `AUTH_DENIED` on GSC tools | SA not added to Search Console property | Follow [GSC steps](#google-search-console-gsc) |
| `AUTH_DENIED` on GA4 tools | SA not added to GA4 property | Follow [GA4 steps](#google-analytics-4-ga4) |
| `AUTH_DENIED` on GA4 write tools | SA has Viewer but needs Editor | Upgrade SA role to Editor in GA4 property access management |
| `AUTH_DENIED` immediately | Wrong credentials file path | Check `GOOGLE_APPLICATION_CREDENTIALS` points to the correct JSON file |
| Tool works for one property but not another | SA added to only one property | Repeat the access grant for the second property |

### Verify the Service Account Email

Always confirm you are granting access to the exact email in your credentials file:

```bash
node -e "
  const fs = require('fs');
  const creds = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS));
  console.log('Service account email:', creds.client_email);
"
```

### GSC Property Format

The `site` parameter for GSC tools accepts multiple formats:

| Input | Normalized to |
|-------|---------------|
| `example.com` | `sc-domain:example.com` |
| `https://example.com` | `sc-domain:example.com` |
| `sc-domain:example.com` | `sc-domain:example.com` (unchanged) |
| `https://example.com/path` | `https://example.com/path` (URL-prefix property) |

Make sure the normalized form matches the property type where you granted access.

### GA4 Property ID Format

The `property_id` parameter for GA4 tools accepts:

| Input | Accepted? |
|-------|-----------|
| `123456789` | ✓ Raw numeric ID |
| `properties/123456789` | ✓ Full resource name |
| `G-XXXXXXXX` | ✗ Measurement ID — use the numeric Property ID from GA4 Admin instead |
| `UA-XXXXXX-X` | ✗ Legacy Universal Analytics ID — not supported |
