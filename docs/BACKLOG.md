# GA4 Manager — SEO Automation Backlog

> Context: wealthsim.app (Next.js, sc-domain:wealthsim.app, GA4 property 514673271).
> Priorities derived from a GSC/GA4 audit session on 2026-06-05.
> Each item includes API feasibility confirmation before implementation is considered.

---

## Priority 1 — High value, confirmed doable

### BO-01 · Keyword Opportunity Finder
**Problem:** wealthsim.app has 9,172 impressions/month but only 50 clicks (0.63% CTR). Many queries are ranking at position 5–20 but not converting to clicks — a title/meta optimisation problem that's invisible without analysis.

**What it does:**
- Queries `gsc_analytics_run` with `dimensions: query,page`
- Filters to position 5–20, impressions ≥ 20, CTR below category median
- Outputs a ranked table of "easy wins": query → page → current position → CTR gap
- Optional: compares to prior period to show trending opportunities

**API feasibility:** ✅ Fully supported via Search Analytics API. 1 request per run.

**Output example:**
```
Query                          Page                        Pos   Impr  CTR    Gap
"s&p 500 investment calc"      /calculator/sp500-investment  8    920   0.3%  -2.1%
"compound interest monthly"    /calculator/compound-interest 12   540   0.4%  -1.8%
```

**Suggested command:** `ga4 gsc opportunities --config configs/wealthsim.yaml`

---

### BO-02 · Content Decay Monitor
**Problem:** Top-performing pages (especially Spanish posts) can lose ranking gradually. Currently there is no automated way to catch this before it becomes a significant traffic loss.

**What it does:**
- Wraps `gsc_traffic_compare` comparing last 28 days vs prior 28 days
- Filters to pages with clicks_delta < -20% AND impressions_delta < -15% (both dropping = decay, not just CTR shift)
- Outputs a "pages losing ground" list with decay severity score
- Separates seasonal drops (position stable, impressions drop) from ranking drops (position worsens)

**API feasibility:** ✅ `gsc_traffic_compare` already exists. Needs a wrapper with decay-specific thresholds.

**Suggested command:** `ga4 gsc decay --config configs/wealthsim.yaml --threshold 20`

---

### BO-03 · Weekly Index Health Cron
**Problem:** The noindex bug on `tfsa-calculator` / `rrsp-calculator` was only discovered during a manual GSC audit. Automated weekly monitoring of priority URLs would catch de-index events within days.

**What it does:**
- Runs `gsc_monitor_urls` on all `search_console.url_inspection.priority_urls` from config
- Diffs results against previous run (stored in a local state file)
- Alerts on: newly de-indexed pages, coverage state regressions, canonical mismatches, mobile usability failures
- Outputs a clean pass/fail summary; only prints issues, silent on all-green

**API feasibility:** ✅ `gsc_monitor_urls` supports up to 50 URLs. 29 priority URLs = 29 quota/run (well within 2000/day). State file is local — no external dependency.

**Quota cost:** 29 requests/week ≈ 4/day average.

**Suggested command:** `ga4 gsc health --config configs/wealthsim.yaml` (run via cron weekly)

---

### BO-04 · Query Cannibalization Detector
**Problem:** When two pages rank for the same query, Google splits authority between them. Neither ranks as well as one consolidated page would. Impossible to spot without cross-referencing query × page data.

**What it does:**
- Pulls `gsc_analytics_run` with `dimensions: query,page`, large limit (5000+ rows)
- Groups by query; finds queries where ≥ 2 pages each have impressions ≥ 10
- Ranks by total impression waste (sum of impressions across cannibalising pages)
- Suggests which page to keep as canonical and which to consolidate or redirect

**API feasibility:** ✅ One API call, existing tool. Pure post-processing logic.

**Suggested command:** `ga4 gsc cannibalization --config configs/wealthsim.yaml --min-impressions 10`

---

### BO-05 · CTR Anomaly Detection
**Problem:** A page can hold its ranking position while CTR drops — always caused by a competitor improving their snippet, a SERP feature stealing clicks, or a title no longer matching search intent. Invisible in standard traffic reports.

**What it does:**
- Runs `gsc_traffic_compare` with `dimensions: query,page`
- Filters to rows where `position_delta` is < 2 (position held) but `ctr_delta` < -30%
- These are "title rot" candidates — ranking fine, but snippet has become uncompetitive
- Output: page → affected queries → CTR before/after → recommended action (rewrite title/meta)

**API feasibility:** ✅ `gsc_traffic_compare` already supports query+page dimensions.

**Suggested command:** `ga4 gsc ctr-anomaly --config configs/wealthsim.yaml`

---

## Priority 2 — Medium value, confirmed doable

### BO-06 · Schema / Rich Results Audit
**Problem:** BlogPosting, BreadcrumbList, and FAQPage schema is deployed across the site but never systematically validated. A single broken template can silently invalidate rich results for all articles.

**What it does:**
- Runs `gsc_inspect_url` on all priority URLs in config
- Reports `rich_results_status` and `rich_result_types` per page
- Flags pages where expected schema type is missing or invalid
- Quota cost: 1 request per URL (29 URLs = 29/2000 daily limit)

**API feasibility:** ✅ URL Inspection API returns rich results data. Rate limit: 2000/day, 600/min.

**Suggested command:** `ga4 gsc schema-audit --config configs/wealthsim.yaml`

---

### BO-07 · Hreflang Cross-Validation
**Problem:** wealthsim.app has hreflang pairs (e.g. `sp500-investment` ↔ `sp500-simulador`). If one side is de-indexed or returns the wrong canonical, Google ignores the entire hreflang signal — breaking Spanish/English geo-targeting silently.

**What it does:**
- Reads hreflang pairs from `CALCULATOR_VARIANTS` config or a dedicated config section
- Inspects both sides of each pair via `gsc_inspect_url`
- Validates: both indexed, google_canonical matches user_canonical on each side, no robots block
- Reports any asymmetry as a hreflang integrity failure

**API feasibility:** ✅ URL Inspection API. Needs hreflang pair mapping in config YAML.

**Config addition needed:**
```yaml
hreflang_pairs:
  - en: "https://www.wealthsim.app/calculator/sp500-investment"
    es: "https://www.wealthsim.app/calculator/sp500-simulador"
```

**Suggested command:** `ga4 gsc hreflang --config configs/wealthsim.yaml`

---

### BO-08 · Redirect Chain Validator
**Problem:** The redirect table in `next.config.ts` has grown to 30+ rules. Chains (A→B→C) waste crawl budget and dilute link equity. Currently validated manually.

**What it does:**
- Takes the redirect source URLs from config
- Inspects each via `gsc_inspect_url` to confirm Google sees them as redirects (not 404s or live pages)
- Flags any source URL that is still indexed (redirect not processed by Google yet)
- Flags chains where the destination also redirects

**API feasibility:** ✅ URL Inspection API + local HTTP HEAD requests to check chains.

**Suggested command:** `ga4 gsc redirects --config configs/wealthsim.yaml`

---

## Priority 3 — Needs new API client (not in scope yet)

### BO-09 · Core Web Vitals Monitoring
**Why deferred:** CWV data is in the CrUX API (Chrome User Experience Report), separate from the Search Analytics API. Would require a new API client and auth scope.

**When to revisit:** Once the site reaches enough real-user traffic for CrUX to have field data (typically 1000+ users/month per page).

---

## What is NOT doable via API (do not implement)

| Task | Reason |
|---|---|
| Request indexing | Removed from GSC API in 2022. UI only. |
| Submit URL removals | No public API. UI only. |
| Create/modify GA4 audiences | GA4 Admin API does not support audience creation. |
| GSC annotations | No API. |
| Real-time GA4 data | Hard 2–3 day lag floor in Data API. |
| Access Google Ads data | Separate API, separate auth, out of scope. |

---

## Implementation notes

- All new commands should follow the existing `ga4 gsc <subcommand> --config` pattern
- State files for diff-based features (BO-03) go in `~/.ga4-manager/state/` or project-local `.ga4-state/`
- Quota tracking already exists — new commands must log quota used per run
- Dry-run flag (`--dry-run`) required on any command that writes state
- Output should be silent on all-green; only print when action is needed
