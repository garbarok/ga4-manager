# GA4 Manager — Domain Context

This file defines the canonical vocabulary for this project. When naming things in issues, ADRs, refactor proposals, test names, or commit messages, use these terms exactly. Don't drift to synonyms listed under "avoid".

---

## Core Concepts

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
