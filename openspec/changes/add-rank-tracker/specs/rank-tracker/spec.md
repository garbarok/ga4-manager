# Spec Delta

## ADDED Requirements

### Requirement: Persistent trackers
A tracker SHALL be stored per site with:
- a market: `location_code` or `location_name`, plus `language_code`;
- a `device` (`desktop|mobile`);
- a `depth` (10–100);
- up to 500 keywords, each normalized (trimmed, whitespace collapsed, lowercase) and optionally pinned.

`rank_tracker_update` SHALL add, remove, pin (adding when missing) and unpin keywords. Market and device SHALL be immutable, so history stays comparable. When `tracker_id` is omitted and the site has exactly one tracker, that tracker is used; otherwise the tool returns `INVALID_INPUT` listing the trackers.

#### Scenario: Duplicate keywords
- **WHEN** a tracker is created with "Alpha  Beta" and "alpha beta"
- **THEN** it holds one keyword "alpha beta"

#### Scenario: Several trackers, no id
- **WHEN** a site has two trackers and `rank_tracker_get` is called without `tracker_id`
- **THEN** it returns `INVALID_INPUT` listing both trackers

### Requirement: Free cost estimate
`rank_tracker_estimate` SHALL price one `serp/google/organic/live/advanced` request per keyword at the live per-request price × ceil(depth / 10). It SHALL count keywords the lookup cache would answer as $0, and return the balance. It SHALL make no billed request.

#### Scenario: Depth 20, two keywords
- **WHEN** the live price is $0.002 per page and depth is 20
- **THEN** the estimate is $0.008

### Requirement: Gated run with stored results
`rank_tracker_run` SHALL pass `gatePaidRun`, then request one SERP per keyword (5 at a time). For each keyword it SHALL store:
- `position` (the `rank_group` of the first organic item whose host is the site or a subdomain, `www.`-insensitive; a `google.com/goto` wrapper resolves through the breadcrumb);
- `rank_absolute` and `url`;
- `serp_features`;
- `ai_overview.{present, site_cited, cited_url}`;
- the top 3 `competitors`.

It SHALL return the estimate, the billed `cost_usd`, and a comparison with the previous run: per keyword `up|down|same|new|lost|unranked|first_run` with `delta = previous − current`. A per-keyword failure is reported in that keyword's `error`; when every keyword fails, the tool fails.

#### Scenario: Over the cap
- **WHEN** the estimate exceeds `max_cost_usd`
- **THEN** no SERP is requested and the tool returns `INVALID_INPUT` with the estimate

#### Scenario: Keyword drops out
- **WHEN** a keyword ranked 3 in the previous run and is absent now
- **THEN** its change is `lost` with `previous: 3, current: null`

### Requirement: History
`rank_tracker_history` SHALL return, per tracked keyword:
- the points `{run_id, ran_at, position, url}`, oldest first, over the last `max_runs` runs;
- `best` and `latest`.

Pinned keywords SHALL come first.

#### Scenario: Two runs
- **WHEN** a keyword ranked 6 then 4
- **THEN** its history lists both points oldest first, with `best: 4` and `latest: 4`
