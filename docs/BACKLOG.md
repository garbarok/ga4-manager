# GA4 Manager — SEO Automation Backlog

> Forward-looking feature backlog for the GSC analysis surface of the CLI.
> Each item names a generic SEO diagnostic any Operator with a GSC site can run.
> API feasibility is confirmed against existing Search Analytics + URL Inspection APIs.
>
> **Cross-cutting decisions** (resolved 2026-06-05 grilling session):
> - CLI + MCP at parity from day one. Every command emits structured output consumed by an MCP tool registered per ADR-0003.
> - Canonical signal vocabulary lives in `CONTEXT.md` (Decay, CTR anomaly, Opportunity, Cannibalisation). BACKLOG predicates below are aligned to those definitions.
> - State storage per ADR-0005: `.ga4-state/<command>.<gsc-site>.json`, gitignored, schema-versioned, `--state-dir` override.
> - "Silent on all-green" = stdout-only convention. Exit `0` all-green, `2` issues detected, `1` command failed. No notification channels in the tool itself — that lives in whatever runs the cron.

---

## P1 — High value, confirmed doable

### BO-01 · Keyword Opportunity Finder
**Problem:** Sites often rank on pages 1–2 for queries they never tuned for. The pages exist, the impressions exist, but the CTR is low because the title/meta was never optimised. Invisible without cross-referencing query × page × position data.

**What it does:**
- Queries `gsc_analytics_run` with `dimensions: query,page`
- Applies the **opportunity** predicate (see CONTEXT.md): `position ∈ [5, 20] AND ctr < category_median_ctr`, where `category_median_ctr` is computed per integer position bucket (industry-standard position-CTR curve)
- Outputs a ranked table of opportunities: query → page → current position → CTR gap vs. position-bucket median
- Opt-in `--compare-to-prior` flag adds a second window for trending mode

**API feasibility:** Fully supported via Search Analytics API. 1 request per run (2 with `--compare-to-prior`).

**Suggested command:** `ga4 gsc opportunities --config <config>.yaml`

---

### BO-02 · Content Decay Monitor
**Problem:** Pages that previously ranked well can slip in position gradually. Without automated comparison against a prior window, the slip becomes a significant traffic loss before anyone notices.

**What it does:**
- Wraps `gsc_traffic_compare` comparing last 28 days vs prior 28 days
- Applies the **decay** predicate (see CONTEXT.md): `position_delta ≥ +1.0 AND clicks_delta ≤ -20%`
- Outputs the matching pages ordered by absolute clicks lost
- Decay is strictly position-driven; pages that lost clicks via CTR collapse without position movement are caught by BO-05 (CTR anomaly)

**API feasibility:** `gsc_traffic_compare` already exists. Needs a wrapper applying the decay predicate.

**Suggested command:** `ga4 gsc decay --config <config>.yaml`

---

### BO-03 · Weekly Index Health Report
**Problem:** A page can be silently de-indexed, develop a canonical mismatch, or fail mobile-usability checks without anyone noticing for weeks. Manual GSC audits catch these only after the traffic loss is measurable. Automated weekly inspection of declared priority URLs surfaces regressions within days.

**What it does:**
- Runs `gsc_monitor_urls` on all `search_console.url_inspection.priority_urls` from config
- Diffs results against previous run (state file per ADR-0005: `.ga4-state/health.<gsc-site>.json`)
- Reports on: newly de-indexed pages, coverage state regressions, canonical mismatches, mobile usability failures
- Silent on all-green (exit 0); prints issues and exits 2 when regressions are detected. Notification routing is the cron wrapper's responsibility — the command itself does not emit webhooks/emails.

**API feasibility:** `gsc_monitor_urls` supports up to 50 URLs per call. URL Inspection quota: 2000/day, so 50 URLs/week ≈ 7/day, well within budget. State file is local — no external dependency.

**Suggested command:** `ga4 gsc health --config <config>.yaml` (driven by cron, launchd, GitHub Actions, etc.)

---

### BO-04 · Query Cannibalization Detector
**Problem:** When two pages on the same site rank for the same query, Google splits authority between them. Neither ranks as well as a consolidated page would. Impossible to spot without cross-referencing query × page data.

**What it does:**
- Pulls `gsc_analytics_run` with `dimensions: query,page`, large limit (5000+ rows)
- Applies the **cannibalisation** predicate (see CONTEXT.md): `≥2 pages on the same query with impressions ≥ 10`
- Ranks queries by total impressions across the cannibalising pages, descending
- Suggests which page to keep as canonical and which to consolidate or redirect

**API feasibility:** One API call, existing tool. Pure post-processing logic.

**Suggested command:** `ga4 gsc cannibalization --config <config>.yaml --min-impressions 10`

---

### BO-05 · CTR Anomaly Detection
**Problem:** A page can hold its ranking position while CTR drops — typically caused by a competitor improving their snippet, a SERP feature stealing clicks, or a title/meta that no longer matches search intent. Invisible in standard traffic reports.

**What it does:**
- Runs `gsc_traffic_compare` with `dimensions: query,page`
- Applies the **CTR anomaly** predicate (see CONTEXT.md): `|position_delta| < 1.0 AND ctr_delta ≤ -30%`
- These are snippet-driven regressions — ranking held, but title/meta stopped converting
- Output: page → affected queries → CTR before/after → recommended action (rewrite title/meta)

**API feasibility:** `gsc_traffic_compare` already supports query+page dimensions.

**Suggested command:** `ga4 gsc ctr-anomaly --config <config>.yaml`

---

## P2 — Medium value, confirmed doable

### BO-06 · Schema / Rich Results Audit
**Problem:** Structured data (BlogPosting, BreadcrumbList, FAQPage, Product, etc.) is typically deployed via templates and then never re-validated. A single broken template can silently invalidate rich results for an entire content type.

**What it does:**
- Runs `gsc_inspect_url` on all priority URLs in config
- Reports `rich_results_status` and `rich_result_types` per page
- Flags pages where an expected schema type is missing or invalid
- Quota cost: 1 request per URL

**API feasibility:** URL Inspection API returns rich results data. Rate limit: 2000/day, 600/min.

**Suggested command:** `ga4 gsc schema-audit --config <config>.yaml`

---

### BO-07 · Hreflang Cross-Validation
**Problem:** Multi-language sites declare hreflang pairs between equivalent pages. If one side is de-indexed, returns the wrong canonical, or is robots-blocked, Google silently ignores the entire hreflang signal — breaking geo-targeting without any error surfacing.

**What it does:**
- Reads hreflang pairs from a dedicated config section
- Inspects both sides of each pair via `gsc_inspect_url`
- Validates: both indexed, `google_canonical` matches `user_canonical` on each side, no robots block
- Reports any asymmetry as a hreflang integrity failure

**API feasibility:** URL Inspection API. Needs hreflang pair mapping in config YAML.

**Config addition needed (open question — see below):**
```yaml
search_console:
  hreflang_pairs:
    - en: "https://example.com/page-en"
      es: "https://example.com/pagina-es"
```

**Suggested command:** `ga4 gsc hreflang --config <config>.yaml`

---

### BO-08 · Redirect Chain Validator
**Problem:** Redirect tables in framework configs (`next.config.ts`, nginx, `_redirects`, etc.) accumulate over time. Chains (A→B→C) waste crawl budget and dilute link equity. Currently validated only by hand, if at all.

**What it does:**
- Takes the redirect source URLs from config
- Inspects each via `gsc_inspect_url` to confirm Google sees them as redirects (not 404s or live pages)
- Flags any source URL that is still indexed (redirect not yet processed by Google)
- Flags chains where the destination also redirects

**API feasibility:** URL Inspection API + local HTTP HEAD requests to check chains.

**Suggested command:** `ga4 gsc redirects --config <config>.yaml`

---

## P3 — Needs new API client (not in scope yet)

### BO-09 · Core Web Vitals Monitoring
**Why deferred:** CWV data is in the CrUX API (Chrome User Experience Report), separate from the Search Analytics API. Would require a new API client and auth scope.

**When to revisit:** Once the Operator's site reaches enough real-user traffic for CrUX to have field data (typically 1000+ users/month per page).

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

- All new commands follow the existing `ga4 gsc <subcommand> --config` pattern (flat, no `analyze` subgroup)
- State files per ADR-0005: `.ga4-state/<command>.<gsc-site>.json`, with `--state-dir` override
- Every command supports `--format text|json`; JSON is the source of truth, text is presentational
- Every JSON output includes a `quota_used` integer; text mode prints it as a footer
- Quota tracking already exists — new commands must log quota used per run
- Dry-run flag (`--dry-run`) required on any command that writes state
- Output silent on all-green; exit 0 success, exit 2 issues detected, exit 1 command failed

---

## Open questions (for next grilling round)

These were surfaced during the 2026-06-05 grilling session but not yet resolved. Recommended answers in parentheses.

1. **BO-08 outbound HTTP probing scope.** The redirect chain validator wants to follow redirects via local HTTP. Does the tool probe only URLs declared in config, or follow chains into arbitrary destinations? What user-agent? Robots.txt respected? (*Recommendation:* probe only config-declared own-site URLs; identify as `ga4-manager/<version>`; do not honour robots.txt for own-site probes; `--max-concurrent` flag with default 4.)
2. **BO-01 prior-period comparison.** The opportunity finder is currently single-window. Should `--compare-to-prior` be a separate flag, or always-on? (*Recommendation:* opt-in flag — single-window is the common case and avoids doubling the quota cost.)
3. **BO-04 "impression waste" definition.** The metric used to rank cannibalisation severity needs a precise formula. (*Recommendation:* `sum(impressions across cannibalising pages) − max(impressions on single page)` — the impressions that would theoretically consolidate onto the canonical page.)
4. **`internal/seo/webvitals.go` stub.** Constants for CWV thresholds exist but BO-09 defers CWV until CrUX traffic is available. Delete the stub, or keep it as a placeholder? (*Recommendation:* delete — per "no half-finished implementations" project guideline. Re-add when BO-09 is picked up.)
5. **BO-07 hreflang config location.** The proposed `hreflang_pairs:` block lives under `search_console:` to keep all GSC-driven config nested together. Confirm? (*Recommendation:* yes.)
