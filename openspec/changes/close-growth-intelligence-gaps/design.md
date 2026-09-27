# Design

## Context

- MCP tools are registered as `cli()` or `native()` ToolSpecs (ADR-0003).
  - GSC diagnostics are Go-first, with CLI+MCP parity (BACKLOG cross-cutting decision).
  - AdSense and the GA4 Data API are only reached natively in TypeScript today (`adsense-client.ts`, and an inline fetch in `ga4-consent-health.ts`).
- Native tools never parse YAML config; anything config-driven goes through the `ga4` binary. The `--all` discovery in `cmd/helpers.go` scans `configs/` and `configs/examples/`.
- `internal/gsc/diagnostics.Opportunity()` already accepts `[page]`-keyed rows and has a baseline CTR curve. Page mode is therefore mostly a peer-selection rule, not a new algorithm.
- Live probing (2026-09-27) established:
  - AdSense v2 rejects `LAST_MONTH`, `LAST_3_MONTHS`, `LAST_6_MONTHS`, `LAST_12_MONTHS` and `LAST_YEAR` with HTTP 400. `orderBy=-METRIC` works.
  - The GA4 Data API exposes `totalAdRevenue`, `publisherAdImpressions` and `publisherAdClicks` by `pagePath`, and they are populated on a property with AdSense linked.
  - ADC user credentials need `x-goog-user-project` (quota project) for AdSense. `getGoogleAuthHeaders` already handles this for the existing tools.

## Goals / Non-Goals

**Goals:**
- Every new diagnostic is a pure function over API rows, testable with fixtures and no network.
- The brief makes no API call that the underlying tools would not make. It composes them.
- No new OAuth scopes and no new runtime dependencies in `mcp/`.

**Non-Goals:**
- No affiliate-network integrations, and no Google Ads or AdMob. Those are separate APIs and auth (see BACKLOG "not doable").
- No CrUX or Core Web Vitals (BO-09 stays deferred).
- No scheduling or notification. Cron wrappers remain the Operator's concern.
- The brief does not write plans. It supplies the facts; the assistant writes the plan.

## Decisions

### D1. Split by data source, not by feature
- GSC diagnostics (`url-hygiene`, `hreflang`, opportunities page mode) are implemented in Go under `internal/gsc/diagnostics/` + `cmd/gsc_*.go`, and exposed via `cli()` specs. This keeps the BACKLOG parity rule and reuses `diagcmd` for format and exit codes.
- The GA4 Data API tools (`ga4_traffic_report`, `site_growth_brief`) are `native()` TypeScript, following the `ga4_consent_health` precedent.
- *Alternative:* a Go GA4 Data client plus CLI commands for everything. Rejected for now: it doubles the surface for a report nobody runs from cron, and the TS client already exists.

### D2. Extract `utils/ga4-data-client.ts`
Move the `runReport` fetch and status→ErrorCode mapping out of `ga4-consent-health.ts` into a shared client, mirroring `adsense-client.ts`. Both `ga4_consent_health` and `ga4_traffic_report` use it. It also fixes the same 4xx→`UPSTREAM_5XX` misclassification there.
- *Alternative:* copy the fetch into the new tool. Rejected, because the same error-mapping bug would then live in two places.

### D3. Shared HTTP status → ErrorCode helper
Add `errorCodeForStatus(status)` in `utils/errors.ts`. Both the AdSense and GA4 clients call it, so the rule is defined in one place:
- 401/403 → `AUTH_DENIED`
- 404 → `NOT_FOUND`
- 429 → `QUOTA_EXCEEDED`
- other 4xx → `INVALID_INPUT`
- 5xx → `UPSTREAM_5XX`

### D4. `ga4 config resolve` for native tools that need config
A new small CLI subcommand: `ga4 config resolve --config <path> | --all --format json`. It emits `[{ path, project, property_id, gsc_site, hreflang_pairs }]`. With `--all` it excludes `configs/examples/`, so the brief never reports on template configs. `ga4_traffic_report` (when given `config`) and `site_growth_brief` call it through the executor.
- *Alternative:* add a YAML dependency to `mcp/`. Rejected, because it would create two config parsers with two validation behaviors.

### D5. Page-mode opportunities: peer floor + baseline fallback
Page mode fetches `dimensions=page` (for accurate page totals) and `dimensions=query,page` (for `top_queries` and `anonymized_share`): 2 quota units. Peers are pages with impressions ≥ `min_impressions`. The command already applies that floor to rows before the predicate (as query mode does today), so the diagnostic only needs a peer-count rule. A bucket needs ≥3 peers to use the site median; otherwise it uses the baseline curve. In page mode the baseline is also a floor: expected CTR = max(site median, baseline). This is `OpportunityWith(rows, OpportunityOptions{MinPeers, BaselineFloor})`. `Opportunity(rows)` keeps `MinPeers: 2` with no floor, so query-mode output is byte-identical.
- Why a floor: on the first live run, peer selection alone missed both of the site's largest opportunities. A low-impression legal page at 0% CTR made the largest page its own bucket median. Fragment URLs at 0% set another bucket's median to 0, which hid a high-impression page converting well below the baseline. A page-level ranking should never excuse a page because its neighbours are also weak. At query level the site's own curve remains the right comparison, which is why only page mode gets the floor.
- Why 3 and not 2: at page level, sites have few pages per bucket. With 2 peers, the median is the midpoint of the target and one other page, which on the observed site hid an opportunity worth thousands of clicks behind a legal-page row.
- *Alternative:* an impression-weighted site median. Rejected: a single large page dominates its own bucket, which masks exactly the case we want to catch.

### D6. URL hygiene is a pure classifier with ordered rules
Rules are evaluated in the precedence order given in the spec, first match wins, so each URL has one issue. Utility-page names and asset routes are fixed lists in Go; there is no config knob in v1. The window defaults to 90 days, because hygiene issues are low-volume and 28 days misses them.

### D7. Hreflang: Go HTTP probe restricted to the site host
This resolves BACKLOG open question 1:
- Probe only URLs on the config's site host.
- User-Agent is `ga4-manager/<version>`.
- robots.txt is not honored for own-site probes.
- At most 4 concurrent fetches, with a 10 s timeout and 5 redirect hops.
- HTML is parsed with `golang.org/x/net/html`, which is already in `go.sum` as indirect and is promoted to a direct dependency.

`hreflang_pairs` lives under `search_console:`, which resolves open question 5.

### D8. Query language inference: small stopword/diacritic scorer
`cross_language_ranking` needs the language of a query. Use a deterministic scorer restricted to the languages present in the pair:
- a short stopword and domain-term list per language (en, es, pt, fr, de to start);
- a bonus for language-specific characters (ñ, á, ç, ß, …).

The winning language needs a margin of ≥1 hit, or the query is skipped. Brand and numeric-only queries score 0 and are skipped. Pairs with a language outside the supported set skip this check and emit one `info` note.
- *Alternative:* a language-detection library. Rejected: 2–6-word queries are too short for statistical detectors to beat a targeted list, and the library adds a dependency.

### D9. Brief composition and size budget
`site_growth_brief` runs per site, with site-level work in parallel:
1. `config resolve`
2. GSC totals and pages for the current and previous windows (2 calls). The previous-window pages call is reused for the deltas.
3. GA4 `runReport` by `pagePath` for both windows (1 call with two `dateRanges`)
4. `gsc opportunities --granularity page`
5. `gsc url-hygiene`
6. `gsc ctr-anomaly`
7. `gsc hreflang`, only when pairs are configured, since discovery is costly

Each step is wrapped so that a failure becomes a `data_gaps` entry. Findings are normalized to `{source, summary, page, impact}` and truncated to 10. `top_pages` is truncated to 10. Numbers are rounded to 4 significant digits to keep each brief under ~4 KB.

### D10. AdSense enum narrowing ships as a breaking-but-safe change
The removed presets never succeeded, so no working caller breaks. The zod enum rejects them, and the hint names `CUSTOM`. The changelog entry is marked BREAKING for correctness.

## Risks / Trade-offs

- [Baseline CTR curve is not vertical-specific, so page-mode `potential_clicks` can overstate gains] → Results carry `median_source` and `anonymized_share`, and tool descriptions call it an upper-bound estimate.
- [Language scorer misclassifies mixed queries such as "calculadora mortgage calculator"] → The margin rule skips ties, so false negatives are preferred to false positives.
- [Hreflang discovery fetches up to 50 pages, which is slow on large sites] → `max_pages` is capped. Declared `hreflang_pairs` bypass discovery, and the brief never runs discovery.
- [GA4 `pagePath` and GSC URLs disagree (locale prefixes, trailing slashes, redirects)] → Paths are normalized. Unmatched pages still appear with nulls rather than being dropped.
- [GSC quota: the brief with `all: true` over N sites costs about 5N Search Analytics calls] → The per-API `quota_used` is reported; 5N is far below the 2000/day limit for realistic N.
- [`totalAdRevenue` in GA4 lags AdSense by ~1 day and can differ slightly from AdSense's own totals] → The tool description says the brief uses GA4-attributed revenue, and `adsense_report` remains the source of truth for payouts.

## Migration Plan

1. Ship the AdSense fixes and the error helper first (independent, smallest). Release as a patch.
2. Ship the GA4 data client extraction and `ga4_traffic_report`.
3. Ship the Go pieces: `config resolve`, opportunities `--granularity`, `url-hygiene`, `hreflang`. Rebuild the binary and repack the MCPB.
4. Ship `site_growth_brief`, which depends on 2 and 3.
5. Minor version bump of the MCP server. Update the README tool count, CONTEXT.md vocabulary, and BACKLOG (BO-07 implemented; open questions 1 and 5 resolved).

Rollback: each step is additive except step 1's enum narrowing, which is safe to revert. No state files are introduced, so no schema migration applies.

## Open Questions

- Should `url-hygiene`'s utility-page list become configurable once an Operator hits a false positive? This can be deferred without changing the v1 contract.
