# Spec Delta

## ADDED Requirements

### Requirement: Per-site project context
`project_context_get` SHALL return, for `site` (or the GSC site of `config`):
- the stored context;
- `exists`;
- the state file path;
- the newest `research_limit` log entries (optionally `research_since`);
- a `research` summary (entries, total cost, de-duplicated recent lookups);
- `missing`: the standard parts not filled in yet.

A site with no file SHALL return an empty context, not an error.

#### Scenario: New site
- **WHEN** no context exists for example.com
- **THEN** the result has `exists: false` and `missing` lists brand_name, the four standard sections, competitors and key_pages

### Requirement: Patch operations
`project_context_update` SHALL apply `operations` in order, with each op one of `add` (fails if present), `upsert` (insert or merge) or `remove` (fails if absent). Targets are brand_name, section, competitor (by normalized domain), key_page (by absolute URL without fragment), and research_log (add a manual entry; remove entries before a date). Any invalid operation SHALL abort the whole update with `INVALID_INPUT` naming its index. `dry_run` SHALL return the result without saving.

#### Scenario: Duplicate competitor
- **WHEN** operations add `rival.example` twice
- **THEN** the call fails with `operations[1]: competitor rival.example is already listed` and nothing is saved

### Requirement: Research log of paid lookups
After any dispatched tool call that made billed DataForSEO requests, those requests SHALL be appended to the site's research log as `{at, tool, endpoint, params, cost_usd}`. Lookups served from cache are not logged. The log keeps the newest 500 entries.

#### Scenario: Input without a site
- **WHEN** a paid tool's input names no site and GA4M_DEFAULT_SITE is unset
- **THEN** the result carries `research_log: {site: null, appended: 0, note}` explaining how to scope it
