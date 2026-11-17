# Proposal

## Why

OpenSEO keeps per-project context that every agent reads first (brand, goals, competitors, key pages). It also caches paid lookups, so a repeat inside a project is free. GA4 Manager has neither. Each agent session starts from zero and re-buys the same DataForSEO data. Nothing records which paid lookups were already made, so the next agent cannot tell what is already known.

## What Changes

- **Project context (item 4).**
  - New tools `project_context_get` and `project_context_update` (CLI: `ga4m project-context-get|update`).
  - Per site, the context stores: `brand_name`; prose `sections` (business_overview, current_goal, positioning, writing_preferences and custom names); `competitors` {domain, name, notes}; `key_pages` {url, role hub|spoke|money|other, topic}; and a dated `research_log`.
  - Updates are a list of patch operations (`add | upsert | remove` × `brand_name | section | competitor | key_page | research_log`), applied in order, all or nothing, with `dry_run`.
  - Stored as `project-context.<site>.json` in the state dir next to the site config (ADR-0005/0006).
- **Automatic research log.** The dispatcher appends every billed DataForSEO request made during a tool call to that site's research log: endpoint, key params, cost, date. `project_context_get` returns a de-duplicated `recent_lookups` list so agents can skip repeats. When an input names no site, the result says why nothing was logged (`GA4M_DEFAULT_SITE` can supply one).
- **Lookup cache (item 9).**
  - `dataforseoRequest` caches responses per site and request parameters (stable-hashed task body) under `<state_dir>/cache/<site>/`.
  - TTLs: 7 days for AI answers (LLM responses, LLM scraper, LLM mentions, Google AI Mode); 6 hours for live SERPs; 24 hours otherwise.
  - A cached repeat costs $0 and is not counted against the session cap. The tool result gains `cache: {hits, misses, cached_at[], note}`.
  - `refresh_cache: true` bypasses reads. `GA4M_CACHE=off` disables the cache; `GA4M_CACHE_TTL_HOURS` overrides TTLs.
  - Cost estimates count requests the cache would answer as free.

## Capabilities

### New Capabilities
- `project-context`: per-site shared agent memory and research log.
- `lookup-cache`: on-disk cache of paid DataForSEO responses.

## Impact

- New: `mcp/src/utils/project-context-store.ts`, `lookup-cache.ts`, `tool-context.ts`, `tools/project-context.ts`.
- Changed: `mcp/src/utils/dataforseo-client.ts` (cache + lookup recording only inside a dispatched call, so direct calls and existing tests are unchanged), `mcp/src/dispatch.ts` (decorates results).
- No new dependencies or scopes.
