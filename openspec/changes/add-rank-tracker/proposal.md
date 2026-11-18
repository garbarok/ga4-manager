# Proposal

## Why

`keyword_rank_check` answers "where do I rank today" for one keyword and forgets the answer. OpenSEO keeps persistent rank trackers: a keyword set per site, market and device, a free cost estimate, stored runs and a position history. Without that, an agent cannot say whether a page moved after a change, and every check is bought again from scratch.

## What Changes

New tools, each also a `ga4m` command (ADR-0006):

- **Local and free** (`local_state` group):
  - `rank_tracker_create`
  - `rank_tracker_update` (add, remove, pin and unpin keywords; rename; change depth)
  - `rank_tracker_get` (latest positions, pinned first, change versus the previous run)
  - `rank_tracker_history`
  - `rank_tracker_list`
  - `rank_tracker_delete`
- **DataForSEO** (`dataforseo` group):
  - `rank_tracker_estimate`: free; prices the run from DataForSEO's own price list.
  - `rank_tracker_run`: paid. One live Google SERP per keyword, behind the cost gate (`max_cost_usd`, default $1, plus the balance check). Results are stored as a run.

A run stores, per keyword:
- the position (Google `rank_group` among organic results), `rank_absolute` and the ranking URL;
- the SERP features present;
- whether the site is cited in the AI Overview;
- the top 3 competing results.

Scheduling stays outside the tool, per the BACKLOG convention:

```
0 6 * * 1  ga4m rank-tracker-run --site example.com --tracker-id <id>
```

## Capabilities

### New Capabilities
- `rank-tracker`: persistent keyword sets, priced runs and position history.

## Impact

- New `mcp/src/tools/rank-tracker-core.ts` (pure model, SERP parsing, comparison, history), `rank-tracker.ts` (8 specs) and `mcp/src/utils/site-input.ts` (shared site/state inputs).
- State: `.ga4-state/rank-trackers/<site>/<id>.json` and `.ga4-state/rank-runs/<site>/<run-id>.json` (ADR-0005 envelope).
- No new dependencies or scopes. DataForSEO credentials are needed only for estimate and run.
