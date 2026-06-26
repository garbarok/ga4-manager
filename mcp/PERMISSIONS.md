# GA4 Manager MCP — Permissions Guide

This guide explains how to grant the access each tool in the GA4 Manager MCP server needs.

> **First time?** Run `./scripts/setup.sh` from the repo root — it walks through auth, API enablement, and smoke tests in one pass, then prints exactly which manual permission grants are still needed below.

## Table of Contents

- [Auth path decision matrix](#auth-path-decision-matrix)
- [Setup A — ADC user credentials (recommended for personal use)](#setup-a--adc-user-credentials-recommended-for-personal-use)
- [Setup B — Service account key (for CI / teams)](#setup-b--service-account-key-for-ci--teams)
- [Google Search Console (GSC)](#google-search-console-gsc)
- [Google Analytics 4 (GA4)](#google-analytics-4-ga4)
- [PageSpeed Insights (PSI)](#pagespeed-insights-psi)
- [AdSense](#adsense)
- [Batch Onboarding](#batch-onboarding)
- [Troubleshooting](#troubleshooting)

---

## Auth path decision matrix

The MCP server reads credentials from the `GOOGLE_APPLICATION_CREDENTIALS` env var. Two file types are accepted:

| Path | File | When to use | Pros | Cons |
|------|------|-------------|------|------|
| **A — ADC user creds** | `~/.config/gcloud/application_default_credentials.json` | Personal/dev use; you query your own GA4 + GSC | Free, fast, no separate user to manage; uses your existing GA4/GSC access | Tied to your Google identity; needs explicit quota project |
| **B — Service account key** | `/path/to/sa-key.json` you download | CI/CD, teams, headless servers | Identity is auditable; clean separation; can be granted property-by-property | Requires SA + key generation; SA email must be added to every GSC site / GA4 property |

**Pick A** unless you need automation outside your laptop.

> Don't mix them — only one `GOOGLE_APPLICATION_CREDENTIALS` value can be active at a time. Switch by setting the env var to a different path.

---

## Setup A — ADC user credentials (recommended for personal use)

```bash
# 1. Re-login with all required scopes
#    (drop the adsense.readonly scope if you don't use the AdSense tools)
gcloud auth application-default login \
  --scopes=openid,\
https://www.googleapis.com/auth/cloud-platform,\
https://www.googleapis.com/auth/analytics.readonly,\
https://www.googleapis.com/auth/webmasters.readonly,\
https://www.googleapis.com/auth/adsense.readonly,\
https://www.googleapis.com/auth/userinfo.email

# 2. Set quota project (the GCP project that gets billed for API calls)
gcloud auth application-default set-quota-project YOUR_PROJECT_ID

# 3. Enable the APIs in that project (adsense.googleapis.com only for AdSense tools)
gcloud services enable \
  analyticsdata.googleapis.com \
  analyticsadmin.googleapis.com \
  searchconsole.googleapis.com \
  pagespeedonline.googleapis.com \
  adsense.googleapis.com \
  --project=YOUR_PROJECT_ID

# 4. Verify
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/application_default_credentials.json"
gcloud auth application-default print-access-token
```

The principal in this case is **your Google account**, so any GA4 properties or Search Console sites you already own are accessible without further per-resource setup. To query someone else's resource, they must add your email as a user (see GSC and GA4 sections below).

> **Common gotcha:** if you skip step 2, calls fail with `SERVICE_DISABLED` even when the API is enabled. The quota project tells Google which project to bill — for ADC user creds, this is not inferred automatically. The Node and Go libraries pick it up from `quota_project_id` in the ADC file once `set-quota-project` runs.

---

## Setup B — Service account key (for CI / teams)

```bash
# 1. Create the SA in Cloud Console (one-time)
#    https://console.cloud.google.com → IAM & Admin → Service Accounts → Create
#    Pick a name (e.g. "ga4-manager") and skip role grants — they aren't used here.

# 2. Create + download a JSON key
#    Service Accounts → click the SA → Keys → Add key → Create new key (JSON)
#    Save the file securely. NEVER commit it.

# 3. Enable the four APIs in the SA's GCP project
gcloud services enable \
  analyticsdata.googleapis.com \
  analyticsadmin.googleapis.com \
  searchconsole.googleapis.com \
  pagespeedonline.googleapis.com \
  --project=YOUR_PROJECT_ID

# 4. Point the env var at the key
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/sa-key.json

# 5. Add the SA email as a user on each resource (see GSC/GA4 sections below)
```

To find the service account email used by the server:

```bash
jq -r .client_email "$GOOGLE_APPLICATION_CREDENTIALS"
# → ga4-manager@your-project.iam.gserviceaccount.com
```

You will need this email to grant access in the sections below.

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

**Affects tools:** `ga4_report`, `ga4_setup`, `ga4_cleanup`, `ga4_validate`, `ga4_link_list`, `ga4_link_create`, `ga4_link_remove`, `ga4_consent_health`

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

> **An API key is effectively required.** The keyless free-tier path is documented as 1 request / 100 seconds, but in practice Google attributes any PSI request from a gcloud-configured environment to your quota project, where the per-day default is **0**. Without a key, `check_cwv: true` calls return HTTP 429 immediately. See [TROUBLESHOOTING.md → "PSI returns 429 with quota_limit_value: 0"](./TROUBLESHOOTING.md#seo_page_audit--psi-returns-429-with-quota_limit_value-0) for the full mechanics.

### Recommended — provision a free PSI API key

The free tier with API key gives 25,000 requests / day, no per-request rate limit.

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Select the same project you used as your GCP quota project (`gcloud auth application-default set-quota-project ...`).
3. **+ Create Credentials** → **API key**.
4. Click **Edit** on the new key. Restrict it:
   - **Application restrictions:** None (or HTTP referrers if calling from a browser).
   - **API restrictions:** Restrict key → check **PageSpeed Insights API** only.
5. Copy the key.
6. Pass it to every `seo_page_audit` call:

   ```jsonc
   {
     "url": "https://example.com/page",
     "check_cwv": true,
     "psi_api_key": "AIzaSy...your-key"
   }
   ```

   Or set it in your MCP client config so you don't have to pass it each call. See `mcp/CONFIGURATION.md`.

### Keyless (NOT recommended)

If you skip the API key, PSI calls will return:

```json
{ "error": { "code": 429, "metadata": { "quota_limit_value": "0", ... } } }
```

The tool surfaces this as a `psi_unavailable` warning and returns the HTML audit without `cwv` data. The `check_cwv: false` path continues to work unaffected.

---

## AdSense

**Affects tools:** `adsense_accounts_list`, `adsense_report`

These read the **publisher** side — earnings from ads running **on your own site** — via the AdSense Management API v2. Unlike the advertiser-side Google Ads API, **no developer token and no Manager (MCC) account are required**. Access is granted by one OAuth scope plus enabling one API:

1. **Scope** — `https://www.googleapis.com/auth/adsense.readonly` must be consented on the credential. For ADC user creds it is already included in the Setup A login above; if you logged in earlier without it, re-run the `gcloud auth application-default login` command (scopes are fixed at login time, not per call).
2. **API** — enable `adsense.googleapis.com` in your quota project (included in the Setup A `gcloud services enable` list above).

> **Use ADC user credentials (Setup A), not a service-account key.** A personal AdSense account is owned by a Google *user*, and there is no way to grant a service-account email access to it. A service-account key authenticates fine but `adsense_accounts_list` returns no accessible accounts. Service accounts can only reach AdSense through Google Workspace domain-wide delegation, which is uncommon.

The principal is your Google account, so any AdSense account you own is accessible with no further per-resource grant. Run `adsense_accounts_list` first to get your `accounts/pub-XXXXXXXXXXXXXXXX` id, then pass it as the `account` argument to `adsense_report`.

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
