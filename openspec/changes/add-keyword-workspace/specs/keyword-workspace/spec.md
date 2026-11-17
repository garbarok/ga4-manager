# Spec Delta

## ADDED Requirements

### Requirement: Saved keyword lists per site
`keywords_save` SHALL upsert keywords into the site's workspace:
- keywords are normalized (trimmed, single spaces, lowercase);
- tags are normalized (lowercase, spaces → `-`) and merged, or replaced when `replace_tags` is true;
- `note` replaces the old note;
- `metrics` (`{keyword: {volume, kd, cpc}}`) replaces stored metrics, stamped with `captured_at`.

A site SHALL hold at most 5,000 keywords. `keywords_list` SHALL filter by `tag` and substring `query`, sort by `keyword | added_at | volume`, and return tag counts. `keywords_remove` SHALL remove by name or by tag, or strip a tag (`untag`) while keeping the keywords.

#### Scenario: Re-saving with a new tag
- **WHEN** "best widgets" is saved with tag "money pages" and later with tag "cluster-a"
- **THEN** it carries both tags `cluster-a` and `money-pages`, and `added_at` is unchanged

### Requirement: Keyword suggestions
`keyword_suggestions` SHALL take the Search Console site from `config` (via `ga4 config resolve`) or `site` (a bare domain becomes `sc-domain:`). Over a `days` window ending 3 days ago, it SHALL return the queries with position in `[min_position, max_position]` (default 4–30) and impressions ≥ `min_impressions` that are not yet saved, by impressions. Without `include_paid` it SHALL make no DataForSEO call. With `include_paid`, it SHALL request `keywords_for_site` behind `gatePaidRun` and flag the paid keywords already present in Search Console.

#### Scenario: Free run
- **WHEN** `include_paid` is false
- **THEN** only Search Console is queried, and `cost_usd` is 0

### Requirement: SERP competitors
`serp_competitors` SHALL accept up to 200 keywords, or a `tag` of saved keywords together with `site`. It SHALL pass `gatePaidRun` (default `max_cost_usd` $0.5), then return per domain: `keywords_count`, `share_of_keywords`, average and median position, visibility, `etv` and `best_positions`. It SHALL set `is_site` for the site and its subdomains, and `is_known_competitor` for domains in the project context. It SHALL list up to 5 unknown domains ranking for ≥ 20% of the set as `suggested_competitors`.

#### Scenario: Site not in the top domains
- **WHEN** the site is not among the returned domains
- **THEN** `site_row` is null and a note says so

### Requirement: Location lookup
`serp_locations` SHALL use only free endpoints and return countries with their languages, filtered so every word of `query` matches. With `include_regions` and `country_iso_code`, it SHALL also return that country's regions and cities. `include_regions` without a country SHALL be `INVALID_INPUT`.

#### Scenario: Region list without a country
- **WHEN** `include_regions` is true and `country_iso_code` is missing
- **THEN** the tool returns `INVALID_INPUT`

### Requirement: Domain overview
`domain_overview` SHALL pass `gatePaidRun` for `domain_rank_overview` (plus `relevant_pages` when `include_pages`). It SHALL return:
- estimated organic traffic and traffic value;
- the ranking keyword count;
- counts per position band (`pos_1` … `pos_91_100`) with `top_3` and `top_10`;
- movement (new, up, down, lost);
- the top pages by estimated traffic.

A domain with no data SHALL produce a warning, not an error.

#### Scenario: Estimate only
- **WHEN** `estimate_only` is true
- **THEN** the tool returns the priced plan and balance and makes no billed request
