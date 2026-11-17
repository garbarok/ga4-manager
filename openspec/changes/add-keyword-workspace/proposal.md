# Proposal

## Why

Keyword research today is a set of one-shot lookups (`keyword_volume`, `keyword_ideas`, `keyword_gap`, `ranked_keywords`) whose results vanish with the session. OpenSEO keeps a per-project keyword list (save_keywords, list_saved_keywords, get_suggested_keywords). It also answers three questions the tool cannot:
- who really competes on a keyword set (find_serp_competitors);
- which location and language codes to use (search_serp_locations);
- how big a domain is (get_domain_overview).

## What Changes

New tools, each also a `ga4m` command (ADR-0006):

- **Keyword workspace** (local, free): `keywords_save`, `keywords_list`, `keywords_remove`.
  - Saved, tagged keyword lists per site in `.ga4-state/keywords.<site>.json`.
  - Saving upserts: tags merge, and a note or metrics replace the old ones.
  - `metrics` stores volume, KD and CPC already bought, so nobody buys them again.
- **`keyword_suggestions`**. Free part: Search Console queries at positions 4–30 with ≥ `min_impressions` that are not yet saved. Optional paid part (`include_paid`): DataForSEO Labs `keywords_for_site`, behind the cost gate.
- **`serp_competitors`** (paid, gated). DataForSEO Labs `serp_competitors` over a keyword list or a saved tag. Returns the domains ranking most across the set, with share of keywords, average and median position, visibility, estimated traffic and best position per keyword. It marks the site itself and the competitors already in the project context, and suggests frequent rankers to add.
- **`serp_locations`** (free). Country and language codes from `dataforseo_labs/locations_and_languages`, plus regions and cities from `serp/google/locations/{country}`, filtered by name. Lists are cached in memory.
- **`domain_overview`** (paid, gated). DataForSEO Labs `domain_rank_overview` (estimated organic traffic and value, keyword counts by position band, movement) plus `relevant_pages` (top pages by estimated traffic).

## Capabilities

### New Capabilities
- `keyword-workspace`: saved keyword lists, suggestions, SERP competitors, location lookup and domain overview.

## Impact

- New files in `mcp/src/tools/`: `keyword-workspace.ts`, `keyword-suggestions.ts`, `serp-competitors.ts`, `serp-locations.ts`, `domain-overview.ts`. Also new: `mcp/src/utils/market.ts` (shared location/language inputs).
- Reuses `querySearchAnalytics` (gsc-traffic-compare), `resolveConfigs`, the cost gate, the lookup cache and the project context.
- No new dependencies or scopes. `keyword_suggestions` without `include_paid` needs only Search Console access.
