# MCP SEO & Traffic Tools — Design Spec

**Date:** 2026-04-25  
**Status:** Approved  
**Scope:** Three new MCP tools added to `mcp/src/tools/`, all implemented natively in TypeScript (no Go binary changes).

---

## Background

The GA4 Manager MCP server currently exposes 13 tools, all thin wrappers around the `ga4` Go CLI binary. Three new tools require APIs that the binary does not support:

- `gsc_traffic_compare` — GSC Search Analytics with explicit date ranges (binary only supports `--days`)
- `ga4_consent_health` — GA4 Data/Reporting API (`analyticsdata/v1beta`); binary uses Admin API only
- `seo_page_audit` — HTTP fetch + HTML parse; no auth, no CLI

Decision: implement all three natively in TypeScript within the MCP layer. Consistent tool shape (Zod input schema → typed output), no Go changes.

---

## Architecture

### New dependencies (`mcp/package.json`)

| Package | Purpose |
|---------|---------|
| `google-auth-library` | JWT/service-account auth; signs requests to any Google API scope |
| `node-html-parser` | Lightweight HTML parser for `seo_page_audit` |

### Shared utility: `mcp/src/utils/google-auth.ts`

```ts
getGoogleAuthHeaders(scopes: string[]): Promise<{ Authorization: string }>
```

- Reads `GOOGLE_APPLICATION_CREDENTIALS` env var → loads service account JSON
- Mints OAuth2 access token for requested scopes
- Caches token in-memory until 5 min before expiry
- Throws descriptive error if credentials missing or invalid

Scopes per tool:
- `gsc_traffic_compare` → `https://www.googleapis.com/auth/webmasters.readonly`
- `ga4_consent_health` → `https://www.googleapis.com/auth/analytics.readonly`
- `seo_page_audit` → none

### File layout

```
mcp/src/utils/google-auth.ts            ← new shared utility
mcp/src/tools/gsc-traffic-compare.ts   ← new tool
mcp/src/tools/ga4-consent-health.ts    ← new tool
mcp/src/tools/seo-page-audit.ts        ← new tool
mcp/src/tools/gsc-traffic-compare.test.ts
mcp/src/tools/ga4-consent-health.test.ts
mcp/src/tools/seo-page-audit.test.ts
```

Registration: add cases to `switch(name)` in `mcp/src/index.ts`, add tool defs to `ListToolsRequestSchema` handler.

---

## Tool 1: `gsc_traffic_compare`

### Purpose
Query GSC Search Analytics for two explicit date ranges, diff per URL, surface biggest drops and gains.

### Input schema

```ts
{
  site: string                    // sc-domain:example.com or https://example.com/
  period_a: { start: string; end: string }  // "YYYY-MM-DD" — baseline (older period)
  period_b: { start: string; end: string }  // "YYYY-MM-DD" — current (newer period)
  dimensions?: string[]           // default: ["page"]
  limit?: number                  // default: 500, max 25000
  min_clicks_a?: number           // filter: only URLs with ≥N clicks in period_a
  sort_by?: "clicks_abs" | "clicks_pct" | "impressions_abs"  // default: "clicks_abs"
}
```

### Logic
1. Get `Authorization` header via `getGoogleAuthHeaders(["webmasters.readonly"])`
2. POST to `https://www.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query` twice — once per period
3. Inner-join results on URL key
4. Compute per-URL deltas: `clicks_delta`, `clicks_pct`, `impressions_delta`, `ctr_delta`, `position_delta`
5. Apply `min_clicks_a` filter to reduce noise from low-traffic URLs
6. Split into `drops` (negative delta) and `gains` (positive delta), sort by `sort_by`
7. Return top 50 drops + top 50 gains (configurable via `limit`)

### Output

```ts
{
  success: boolean
  site: string
  period_a: string          // "2026-03-01 to 2026-03-31"
  period_b: string          // "2026-04-01 to 2026-04-24"
  summary: {
    urls_compared: number
    urls_only_in_a: number  // disappeared from period_b
    urls_only_in_b: number  // new in period_b
  }
  drops: TrafficDiff[]      // sorted worst-first
  gains: TrafficDiff[]      // sorted best-first
  unchanged: number         // URLs with <5% change in clicks
}

// TrafficDiff
{
  url: string
  clicks_a: number; clicks_b: number; clicks_delta: number; clicks_pct: number
  impressions_a: number; impressions_b: number; impressions_delta: number
  ctr_a: number; ctr_b: number
  position_a: number; position_b: number
}
```

### Error handling
- 403 → "GSC access denied — check service account has Search Console access"
- 429 → "GSC quota exceeded — 2000 req/day limit"
- Invalid date format → Zod validation error before API call

---

## Tool 2: `ga4_consent_health`

### Purpose
Report consent signal health: what % of sessions have analytics/ads consent granted vs denied, using both Consent Mode v2 built-in dimensions and optional custom consent events.

### Input schema

```ts
{
  property_id: string           // "properties/123456789"
  days?: number                 // default: 28
  custom_grant_event?: string   // e.g. "consent_granted"
  custom_deny_event?: string    // e.g. "consent_denied"
}
```

### Logic
1. Get `Authorization` header via `getGoogleAuthHeaders(["analytics.readonly"])`
2. POST to `https://analyticsdata.googleapis.com/v1beta/{property_id}:runReport`

**Call 1 — Consent Mode signals:**
- Dimensions: `privacyInfoAnalyticsStorage`, `privacyInfoAdsStorage`
- Metric: `sessions`
- Date range: last `days` days

**Call 2 — Custom events** (only if `custom_grant_event` or `custom_deny_event` provided):
- Dimension: `eventName`
- Metric: `eventCount`
- Filter: `eventName IN [custom_grant_event, custom_deny_event]`

Derive `granted_pct`, `denied_pct`, `unset_pct` from session counts. If Consent Mode returns no data (property not configured), set `available: false`.

Health score logic:
- `healthy` — analytics_storage denied < 10%
- `warning` — denied 10–30%
- `critical` — denied > 30%

### Output

```ts
{
  success: boolean
  property_id: string
  period: string              // "last 28 days"
  consent_mode: {
    analytics_storage: {
      granted_pct: number
      denied_pct: number
      unset_pct: number
      total_sessions: number
    }
    ads_storage: {
      granted_pct: number
      denied_pct: number
      unset_pct: number
      total_sessions: number
    }
    available: boolean
  }
  custom_events?: {
    grant_event: string
    grant_count: number
    deny_event: string
    deny_count: number
    consent_rate_pct: number
  }
  health_score: "healthy" | "warning" | "critical"
  error?: string
}
```

### Error handling
- 403 → "GA4 Data API access denied — check service account has Viewer role on property"
- Property not found → clear error with property_id echoed
- No consent data → `available: false`, not an error

---

## Tool 3: `seo_page_audit`

### Purpose
Fetch a URL, parse on-page SEO signals, return structured issue list. Optionally check Core Web Vitals via PageSpeed Insights API.

### Input schema

```ts
{
  url: string
  user_agent?: string         // default: Googlebot UA
  check_cwv?: boolean         // default: false
  psi_api_key?: string        // optional — PSI works without key but rate-limits at ~1 req/100s
  psi_strategy?: "mobile" | "desktop"  // default: "mobile"
}
```

### Logic

**HTML audit:**
1. `fetch(url, { headers: { "User-Agent": user_agent } })` — follow redirects, record `final_url` and `status_code`
2. Parse with `node-html-parser`
3. Extract signals (see below)
4. Run issue rules → produce `issues[]` with `severity: "error"|"warning"|"info"`

**CWV (if `check_cwv: true`):**
- GET `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={url}&strategy={strategy}&key={psi_api_key}`
- Extract `lcp`, `fcp`, `cls`, `tbt`, `performance_score` from Lighthouse categories

### Signals extracted

| Signal | Source |
|--------|--------|
| `title` | `<title>` text + length |
| `description` | `<meta name="description">` content + length |
| `canonical` | `<link rel="canonical">` href |
| `og_tags` | `og:title`, `og:description`, `og:image`, `og:type` |
| `robots` | `<meta name="robots">` — noindex/nofollow flags |
| `schema_types` | JSON-LD `<script type="application/ld+json">` — array of `@type` values |
| `h1_count` | Count of `<h1>` elements |
| `h2_count` | Count of `<h2>` elements |
| `hreflang_count` | Count of `<link rel="alternate" hreflang>` tags |

### Issue rules

| Field | Condition | Severity |
|-------|-----------|----------|
| title | Missing or empty | error |
| title | Length < 10 or > 60 | warning |
| description | Missing | warning |
| description | Length > 160 | warning |
| canonical | Missing | warning |
| canonical | Points to different domain | error |
| robots | `noindex` present | error |
| h1 | Count = 0 or > 1 | warning |
| og:image | Missing | info |

### Output

```ts
{
  success: boolean
  url: string
  final_url: string           // after redirects
  status_code: number
  signals: {
    title: string | null
    title_length: number
    description: string | null
    description_length: number
    canonical: string | null
    robots: string | null
    noindex: boolean
    og: { title; description; image; type }
    schema_types: string[]
    h1_count: number
    h2_count: number
    hreflang_count: number
  }
  issues: Array<{
    field: string
    severity: "error" | "warning" | "info"
    message: string
  }>
  issue_summary: { errors: number; warnings: number; infos: number }
  cwv?: {
    lcp: number               // ms
    fcp: number               // ms
    cls: number               // score
    tbt: number               // ms
    performance_score: number // 0-100
    strategy: "mobile" | "desktop"
  }
}
```

### Error handling
- Non-2xx status → `success: true` but `status_code` reflects it, issues include "Page returned {status}"
- Fetch timeout (10s) → `success: false`, error message
- PSI failure → `cwv` omitted, `cwv_error` string added

---

## Registration in `index.ts`

Add to `ListToolsRequestSchema` handler:
```ts
gscTrafficCompareTool,
ga4ConsentHealthTool,
seoPageAuditTool,
```

Add three `case` blocks to `CallToolRequestSchema` switch:
```ts
case 'gsc_traffic_compare': { ... }
case 'ga4_consent_health': { ... }
case 'seo_page_audit': { ... }
```

No `CLIExecutor` involved — handlers call tool functions directly.

---

## Testing strategy

Each tool file gets a `.test.ts` with:
- Input validation (Zod schema edge cases)
- Output parsing with mocked API responses (vitest `vi.mock` / `vi.fn`)
- Issue rule logic unit tests (for `seo_page_audit`)
- Error path coverage (403, 429, timeout)

Auth utility tested separately with a mocked `google-auth-library`.

---

## Out of scope

- Go binary changes
- CWV historical trending (PSI is point-in-time only)
- `seo_page_audit` JavaScript rendering (fetches raw HTML only — Googlebot-UA is a hint, not a headless browser)
- Batch URL auditing (call `seo_page_audit` in a loop from Claude)
