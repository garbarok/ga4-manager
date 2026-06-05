# GA4 Manager — Domain Context

This file defines the canonical vocabulary for this project. When naming things in issues, ADRs, refactor proposals, test names, or commit messages, use these terms exactly. Don't drift to synonyms listed under "avoid".

## Framing

GA4 Manager is a generic, open-source CLI. It has one type of consumer — the **Operator** — and no first-class downstream projects. The configs under `configs/examples/` are illustrative templates; any config that happens to be checked in elsewhere in the repo (e.g. `configs/<name>.yaml`) is a sample, not a stakeholder. Feature requests should describe what the Operator can do with the tool against *their* GA4 properties and GSC sites, not against any specific site the maintainers happen to run.

---

## Core Concepts

### Operator
The person running the GA4 Manager CLI (or driving the MCP server) against one or more of their own GA4 properties and GSC sites. The Operator owns the YAML config(s), supplies the credentials via ADC, and decides where state and credentials live. Whenever this document or an ADR says "the Operator does X" it means the human in front of the tool, not the tool's maintainers.

Avoid: "user", "customer", "client" (those carry product connotations this tool doesn't have).

### Property
A Google Analytics 4 property identified by a numeric **property ID** (e.g. `123456789`). Distinct from a GCP project. All GA4 Admin API calls use the resource path `properties/{propertyID}`.

Avoid: "analytics account", "GA4 account", "site".

### Conversion event
A GA4 event marked as a conversion. Has a **counting method**: `ONCE_PER_SESSION` or `ONCE_PER_EVENT`. Created via the `ConversionEvents` API resource.

Avoid: "goal", "conversion action".

### Custom dimension
A user-defined event parameter registered with GA4 for use in reports. Has a **parameter name** (the slug used in tracking code) and a **scope**: `EVENT`, `USER`, or `ITEM`.

Avoid: "custom attribute", "dimension parameter".

### Custom metric
A user-defined numeric measurement registered with GA4. Has a **parameter name**, a **measurement unit** (`STANDARD`, `CURRENCY`, `MILLISECONDS`, `SECONDS`, `MINUTES`, `HOURS`, `FEET`, `METERS`, `KILOMETERS`, `MILES`), and a **scope** (always `EVENT`). Currency metrics additionally require a **restricted metric type**: `COST_DATA` or `REVENUE_DATA`.

Avoid: "custom KPI", "metric parameter".

### Calculated metric
A derived metric defined by a formula over other metrics. Not backed by raw event data; computed at query time.

### Parameter name
The lowercase slug that identifies a custom dimension or metric in GA4 (e.g. `user_tier`, `cart_value`). **Permanently reserved after archiving** — the name cannot be reused even after the resource is deleted or archived. Additionally, names starting with `google_`, `ga_`, or `firebase_` are rejected at validation time, and a set of specific names (`session_id`, `user_id`, `ga_session_id`, `ga_session_number`, `engagement_time_msec`, `firebase_screen`, `firebase_screen_class`) are permanently blocked by the API regardless of prefix. See `docs/agents/ga4-constraints.md` for the full list.

Avoid: "parameter key", "metric slug".

### Tier
The GA4 property tier: `standard` (free) or `360` (paid). Governs resource limits — 30 vs 50 conversions; 50 vs 125 dimensions and metrics. Config files specify tier via the `tier` field; defaults to `standard`.

### Priority
An optional field (`high`, `medium`, `low`) on conversions, dimensions, and metrics. When a config contains more resources than the tier allows, setup creates high-priority resources first and drops lower-priority ones rather than failing. Defaults to low when omitted.

### Archiving
GA4's "soft delete" for custom dimensions and metrics. Archiving hides a resource from reports but permanently reserves its parameter name. **Cleanup operations archive resources, not delete them.**

Avoid: "deleting a dimension", "removing a metric" (unless you mean the config entry, not the GA4 resource).

### Setup
The idempotent operation of creating GA4 resources from a YAML config file. Resources that already exist are skipped (not overwritten). Supports `--dry-run` to preview without applying.

### GSC site
A Search Console verified property. Two formats: `sc-domain:example.com` (domain property, covers all subdomains and protocols) or `https://example.com/` (URL-prefix property, covers exact prefix only).

Avoid: "GSC property", "Search Console account".

### ADC (Application Default Credentials)
Google's credential discovery chain. Supports both user credentials (via `gcloud auth application-default login`) and service account keys (via `GOOGLE_APPLICATION_CREDENTIALS` env var). The project uses ADC for all API calls.

### MCP tool
One of the 16 structured operations exposed by the MCP server in `mcp/` to AI assistants. Each tool maps to either a CLI command (spawned as a subprocess) or a native TypeScript implementation.

---

## SEO Diagnostics

The four canonical signals the GSC analysis commands report. Each is a strict, mutually-exclusive predicate over a query×page row, defined so that a given comparison window classifies a page into at most one of decay/CTR anomaly. Opportunity and cannibalisation are orthogonal — a page may simultaneously be an opportunity and a cannibalisation participant.

### Decay
A page slipping in ranking, with downstream traffic loss. Position-driven.

```
decay ≔ position_delta ≥ +1.0 AND clicks_delta ≤ -20%
```

Avoid: "traffic drop", "ranking loss" (decay is the specific predicate above).

### CTR anomaly
A page holding its position but converting fewer clicks per impression. Snippet-driven — usually a SERP feature stealing clicks, a competitor's better title, or stale meta description.

```
ctr_anomaly ≔ |position_delta| < 1.0 AND ctr_delta ≤ -30%
```

Avoid: "title rot" (use CTR anomaly).

### Opportunity
A page ranking on page 1–2 but under-converting relative to its peer group. Tuning candidate — usually title/meta optimisation.

```
opportunity ≔ position ∈ [5, 20] AND ctr < category_median_ctr
```

**Category (v1):** the position bucket. For a row at position *p*, `category_median_ctr` is the median CTR of all rows in the same site/window at `round(p)`. This is the industry-standard position-CTR-curve approach and requires zero config. The term *category* is intentionally left abstract so it can later graduate to a page-template clustering (e.g. `/calculator/*` vs `/blog/*`) without renaming the concept.

Avoid: "easy win", "low-hanging fruit".

### Cannibalisation
Two or more pages on the same site ranking for the same query, splitting authority.

```
cannibalisation ≔ ≥2 pages on the same query with impressions ≥ 10
```

The `canonical_candidate` field on a cannibalisation result is a heuristic: it is the page with the highest current impressions on the query, **not** Google's chosen canonical. For migrating sites GSC may still attribute impressions to a legacy URL inside its 28-day window, so the impression leader can be the page the Operator intends to redirect away from. When precision matters, callers can request a per-page coverage_state lookup which annotates each finding with a severity tier:

- `actionable` — every page in the result is in a non-redirect coverage state.
- `consolidating` — at least one page is `Page with redirect`; the migration is mid-flight and the finding will decay out of the GSC attribution window on its own.

Avoid: "duplicate ranking", "query overlap".

---

## Resource Limits (Quick Reference)

| Resource | Standard | GA4 360 |
|----------|----------|---------|
| Conversion events | 30 | 50 |
| Custom dimensions | 50 | 125 |
| Custom metrics | 50 | 125 |

---

## Layers

```
YAML config
    ↓
cmd/           CLI entry points (Cobra commands)
    ↓
internal/ga4/  GA4 Admin API client (rate-limited, idempotent)
    ↓
Google Analytics Admin API v1alpha

mcp/           TypeScript MCP server (16 tools)
    ↓ (spawns or calls)
cmd/ binary or native fetch
```

The `internal/ga4/` package owns all GA4 API interaction. `cmd/` orchestrates config loading, validation, and output. The MCP server in `mcp/` is a separate process that invokes the CLI or makes direct API calls for tools that don't fit the CLI pattern.
