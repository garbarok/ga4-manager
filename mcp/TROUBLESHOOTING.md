# GA4 Manager MCP — Troubleshooting

Every error message you might see while setting up or running the MCP server, and the exact fix. Symptoms are quoted verbatim from real responses.

If your error is not here, please [open an issue](https://github.com/garbarok/ga4-manager/issues) with the full error and the command that produced it.

## Table of Contents

- [Authentication errors](#authentication-errors)
- [API enablement errors](#api-enablement-errors)
- [Permission errors](#permission-errors)
- [Property ID and site format errors](#property-id-and-site-format-errors)
- [Tool-specific errors](#tool-specific-errors)
- [False positives (signals to ignore)](#false-positives-signals-to-ignore)
- [MCP server / Claude Desktop errors](#mcp-server--claude-desktop-errors)

---

## Authentication errors

### `Request had insufficient authentication scopes.` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`

```json
{
  "error": {
    "code": 403,
    "status": "PERMISSION_DENIED",
    "message": "Request had insufficient authentication scopes."
  }
}
```

**Cause:** Your access token was minted without the right OAuth scope. Plain `gcloud auth print-access-token` returns a token with `cloud-platform` only — the Analytics Data API needs `analytics.readonly`, Search Console needs `webmasters.readonly`.

**Fix (ADC user creds):** Re-login with all required scopes:

```bash
gcloud auth application-default login \
  --scopes=openid,\
https://www.googleapis.com/auth/cloud-platform,\
https://www.googleapis.com/auth/analytics.readonly,\
https://www.googleapis.com/auth/webmasters.readonly,\
https://www.googleapis.com/auth/userinfo.email
```

**Fix (service account key):** SA tokens don't have this issue — `google-auth-library` requests the scope at runtime. If you see this with an SA, the SA key path is probably pointing to a user-creds file. Verify:

```bash
jq -r .type "$GOOGLE_APPLICATION_CREDENTIALS"
# Should print: service_account
# If it prints: authorized_user → that is ADC, not an SA key
```

**Fix (one shot):** Run `./scripts/setup.sh` from the repo root — it handles this for you.

---

### `The .json key file is not in a valid format.`

```
ERROR: (gcloud.auth.activate-service-account) The .json key file is not in a valid format.
```

**Cause:** `$GOOGLE_APPLICATION_CREDENTIALS` points at an ADC user-creds file (`application_default_credentials.json`), not a service account key.

The two file types look similar but have different shapes:

| File | `type` field | Use with |
|------|--------------|----------|
| ADC user creds | `"type": "authorized_user"` | `gcloud auth application-default ...` commands |
| SA key | `"type": "service_account"` | `gcloud auth activate-service-account` |

**Fix:** Either:

- Use ADC path instead: `gcloud auth application-default login --scopes=...` (skip `activate-service-account`).
- Download a real SA key from Cloud Console → IAM → Service Accounts → Keys → Add Key → Create new key (JSON), then point `GOOGLE_APPLICATION_CREDENTIALS` at it.

See [PERMISSIONS.md → Auth path decision matrix](./PERMISSIONS.md#auth-path-decision-matrix).

---

### `unable to detect a Project Id` / no `quota_project_id`

```
... requires a quota project, which is not set by default ...
```

**Cause:** ADC user creds need an explicit quota project (the project that gets billed and counts requests against quota).

**Fix:**

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

Or pass `X-Goog-User-Project: YOUR_PROJECT_ID` as a header on each request (the Node and Go libraries do this automatically once the quota project is set on ADC).

---

## API enablement errors

### `The X.googleapis.com API requires a quota project ...` / `SERVICE_DISABLED`

```json
{
  "error": {
    "code": 403,
    "status": "PERMISSION_DENIED",
    "message": "Your application is authenticating by using local Application Default Credentials. The analyticsdata.googleapis.com API requires a quota project, which is not set by default."
  }
}
```

**Cause (one of):**

1. The API is not enabled in your quota project.
2. ADC has no quota project set.
3. Quota project header is missing on a manual curl.

**Fix — enable all four APIs at once:**

```bash
gcloud services enable \
  analyticsdata.googleapis.com \
  analyticsadmin.googleapis.com \
  searchconsole.googleapis.com \
  pagespeedonline.googleapis.com \
  --project=YOUR_PROJECT_ID
```

**Fix — set quota project on ADC:**

```bash
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

**Fix — for manual curl, add the header:**

```bash
curl ... -H "X-Goog-User-Project: YOUR_PROJECT_ID"
```

The `./scripts/setup.sh` script handles all three for you.

---

## Permission errors

### `User does not have sufficient permissions for this property.`

```json
{
  "error": {
    "code": 403,
    "status": "PERMISSION_DENIED",
    "message": "User does not have sufficient permissions for this property."
  }
}
```

**Cause:** The authenticated principal (your Google account if ADC; the SA email if SA key) is not added as a user on the GA4 property.

**Fix:**

1. Open https://analytics.google.com → select the property.
2. Bottom-left **Admin** (gear icon) → **Property access management**.
3. **+** → **Add users** → enter the principal email.
4. Assign **Viewer** (read-only is enough for `ga4_report` and `ga4_consent_health`).

For service accounts, find the email with:

```bash
jq -r .client_email "$GOOGLE_APPLICATION_CREDENTIALS"
```

For batch onboarding many properties at once, use the script:

```bash
cd mcp
npx tsx scripts/provision-ga4-access.ts \
  --sa-email "ga4-manager@your-project.iam.gserviceaccount.com" \
  123456789 987654321
```

See [PERMISSIONS.md → Batch Onboarding](./PERMISSIONS.md#batch-onboarding).

---

### `User does not have sufficient permissions for site` (GSC)

**Cause:** The authenticated principal is not added as a user in Search Console for that site.

**Fix:** Manual only — Search Console has no API for granting access.

1. Open https://search.google.com/search-console → select the property.
2. **Settings** (gear, bottom-left) → **Users and permissions** → **Add user**.
3. Enter the principal email.
4. Choose level:
   - **Restricted** — read-only, enough for traffic queries.
   - **Full** — also lets you manage sitemaps.

`sc-domain:example.com` (Domain property) and `https://example.com` (URL-prefix property) are **separate** in Search Console — grant access to the one your tools query.

---

## Property ID and site format errors

### `'G-XXXXXXXX' is a Measurement ID, not a Property ID.`

**Cause:** GA4 has two distinct identifiers:

- **Measurement ID** — `G-XXXXXXXX` — used in your website's gtag.js snippet. NOT accepted by the Admin/Data APIs.
- **Property ID** — purely numeric (e.g. `123456789`) — what the APIs need.

**Fix:** Find the Property ID at GA4 Admin → Property → Property settings (not Data Streams).

The MCP tools accept either `123456789` or `properties/123456789`.

---

### `'UA-XXXXX-X' is Universal Analytics (deprecated).`

UA stopped collecting data on 1 July 2024. Migrate to GA4 — there's no path forward for UA.

---

### `Site format unrecognized` / 404 on GSC tools

**Cause:** Mismatch between input and the property type registered in Search Console.

| Input | Treated as |
|-------|-----------|
| `example.com` | `sc-domain:example.com` (Domain property) |
| `https://example.com/` | `https://example.com/` (URL-prefix property) |
| `https://example.com` | normalized to `https://example.com/` (trailing slash added) |

If you registered Search Console as a Domain property but pass a URL-prefix string (or vice versa), the API returns 404. Match the format to what you set up in Search Console.

---

## Tool-specific errors

### `ga4_consent_health` returns `available: false` for everything

```json
{
  "consent_mode": { "available": false, "error": "no_consent_data" }
}
```

**Cause:** GA4's Consent Mode v2 status fields are NOT exposed on the Data API. The tool falls back to counting custom `consent_granted` / `consent_denied` events. If you have not instrumented those events on your site, the tool has nothing to report.

**Fix:** Instrument the events. Example with gtag.js:

```js
// On banner accept:
gtag('event', 'consent_granted', { event_category: 'consent_banner' });

// On banner reject:
gtag('event', 'consent_denied', { event_category: 'consent_banner' });
```

Then call the tool with the matching event names:

```jsonc
{
  "property_id": "123456789",
  "grant_event": "consent_granted",
  "deny_event": "consent_denied"
}
```

The tool reports `consent_rate_pct` (grants / decisions) and `consent_visibility_pct` (decisions / page views — flags banner-bypass cases).

---

### `Field 'privacyInfoAnalyticsStorage' is not a valid dimension`

**Cause:** Outdated client trying to use the deprecated dim-based design. The current `ga4_consent_health` is events-based and does not call this dimension. Update to the latest MCP server version:

```bash
cd mcp
git pull
npm install
npm run build
```

Restart your MCP client (Claude Desktop, etc.).

---

### `seo_page_audit` — robots.txt blocks the URL

```json
{
  "success": true,
  "blocked_by_robots": true,
  "signals": null
}
```

**Cause:** The site's `robots.txt` disallows the user agent (default is honest UA). Default behavior respects robots.txt.

**Fix (only if you own the site):** override the UA:

```jsonc
{
  "url": "https://example.com/page",
  "as_googlebot": true
}
```

This sets the request UA to Googlebot's — useful for debugging cloaking but ethically restricted to sites you own.

To override the UA freely:

```jsonc
{
  "url": "https://example.com/page",
  "respect_robots": false,
  "user_agent": "Mozilla/5.0 ..."
}
```

---

### `seo_page_audit` — PageSpeed Insights returns `cwv_unavailable`

**Cause:** The free PSI tier rate-limits to ~1 request per 100 seconds. Batch audits hit this fast.

**Fix:** Provision a free PSI API key (no quota cap). See [PERMISSIONS.md → PageSpeed Insights](./PERMISSIONS.md#pagespeed-insights-psi).

---

### `seo_page_audit` — PSI returns 429 with `quota_limit_value: "0"`

```json
{
  "warnings": [
    "psi_unavailable: PSI API error (HTTP 429): ... \"quota_limit_value\": \"0\", \"quota_limit\": \"defaultPerDayPerProject\" ..."
  ]
}
```

**Cause:** Even though the tool calls PSI without an Authorization header, Google attributes the request to your gcloud-configured quota project (visible in the error as `consumer: projects/<number>`). The default per-project per-day PSI quota is **0**, not the documented 25k. Without an API key, the request lands in the zero-allocation lane and gets immediately rejected — no warm-up grace, no fallback to keyless rate-limited mode.

This affects every user who follows `scripts/setup.sh` exactly: the API enables fine, the smoke test fails, and `check_cwv: true` calls fail forever until the API key is provisioned.

**Fix — create a free PSI API key:**

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Select your project (the same one used for `GCP_PROJECT` / quota project, e.g. `portfolio-blog-479009`).
3. **+ Create Credentials** → **API key**.
4. Click **Edit** on the new key:
   - **Application restrictions:** None (or HTTP referrers if calling from a browser).
   - **API restrictions:** Restrict key → check **PageSpeed Insights API** only.
   - Save.
5. Copy the key.
6. Pass the key to `seo_page_audit` calls:

   ```jsonc
   {
     "url": "https://example.com",
     "check_cwv": true,
     "psi_api_key": "AIzaSy...your-key"
   }
   ```

   Or set the `PSI_API_KEY` env var in your MCP client config so you don't have to pass it every call (when supported — see `mcp/CONFIGURATION.md`).

**Why this is required:** with an API key, PSI bills against your project at the documented 25k requests/day free tier. Without a key, the default per-project allocation is 0 — Google reserves "free unauthenticated" PSI for anonymous traffic with no GCP context, and once Google's edge identifies you as a gcloud user, you're routed to the per-project lane that has zero allocation by default.

The tool's keyless throttle (`bottleneck` 1 req per 100s) still applies as a safety net, but it doesn't help when the per-day allocation itself is zero.

---

### `gsc_traffic_compare` — periods overlap warning

```json
{
  "success": true,
  "warnings": ["periods overlap: period_a ends 2026-04-15, period_b starts 2026-04-10"]
}
```

**Cause:** Your two date ranges overlap. The diff still computes but mixes baseline and current.

**Fix:** Adjust ranges so `period_a.end < period_b.start`. Or ignore the warning if overlap is intentional.

---

### `PARTIAL_FETCH_FAILED` on `gsc_traffic_compare`

```json
{
  "success": false,
  "error": {
    "code": "PARTIAL_FETCH_FAILED",
    "message": "period_a failed: ...",
    "hint": "period_b succeeded; retry period_a only"
  }
}
```

**Cause:** One of the two GSC requests failed (most often quota or transient 5xx).

**Fix:** Retry the call. The two requests run in parallel; transient failure on one does not invalidate the other.

---

## False positives (signals to ignore)

These signals look like problems but are not. Do not report them as page defects
or open issues for them — they are upstream-deprecated fields or missing
measurements, not failures of the audited site.

### `MobileUsable: false` on every URL (`gsc_inspect_url`, `gsc_monitor_urls`, `gsc_health`)

```json
{
  "MobileUsable": false,
  "MobileIssues": []
}
```

**This is not a mobile problem.** Google **deprecated the Mobile Usability report
and the URL Inspection API's `mobileUsability` field in December 2023** (the
report was fully removed in 2024). The API now returns `MobileUsable: false`
(typically with an **empty `MobileIssues` array**) for *every* URL regardless of
how mobile-friendly the page actually is. It is a sunset-field artifact.

**Tell-tale sign:** *all* inspected URLs report `false` with no issues listed. A
real usability defect would affect specific pages and populate `MobileIssues`.

**What to do:** ignore the field. To assess real mobile UX, measure Core Web
Vitals via `seo_page_audit` with `check_cwv: true` (requires a PSI API key — see
[PSI returns 429](#seo_page_audit--psi-returns-429-with-quota_limit_value-0)), or
run Lighthouse. Health-diff tooling should **not** treat `mobile_usable`
transitioning to `false` as a regression in isolation.

---

### `cwv_unavailable` / `psi_unavailable` means "not measured", not "failed"

A `cwv_unavailable` or `psi_unavailable` warning from `seo_page_audit` means Core
Web Vitals **could not be fetched** (no PSI API key / rate limit / `quota = 0` —
see the [PSI 429 section](#seo_page_audit--psi-returns-429-with-quota_limit_value-0)).
It is **not** a signal that the page failed CWV. Do not report a page as failing
Core Web Vitals on the basis of a missing measurement — provision the PSI key
first, then re-audit.

---

## MCP server / Claude Desktop errors

### Claude Desktop says "ga4-manager server failed to start"

**Likely causes:**

1. `node` not in PATH — give absolute path in `command`.
2. `dist/index.js` missing — run `cd mcp && npm run build`.
3. Permissions — `chmod +x mcp/dist/index.js`.

Check Claude Desktop's MCP logs for the actual stderr.

---

### Tools don't appear in Claude Desktop after restart

1. Verify config file syntax with `jq`:
   ```bash
   jq . ~/.config/claude-desktop/config.json
   ```
2. Restart Claude Desktop completely (Quit + relaunch — not just close window).
3. Check the `mcpServers.ga4-manager` entry has `command` and `args` pointing at real paths.

---

### `cannot find module '@anthropic-ai/sdk'` or similar

`mcp/node_modules/` is incomplete. Rebuild:

```bash
cd mcp
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## When all else fails

1. Run `./scripts/setup.sh` — it re-checks every prerequisite, scope, API, and connection.
2. Check the [GitHub issues](https://github.com/garbarok/ga4-manager/issues).
3. Open a new issue with:
   - The exact command you ran
   - The full error response (redact your property ID / SA email if sensitive)
   - Your auth path (ADC or SA key)
   - macOS / Linux / Windows
