# Docs to merge

> Merged into README.md, mcp/README.md, CHANGELOG.md and mcp/CHANGELOG.md on 2026-11-18. Kept as the change's record.

## README tool table (row)

| Rank tracking | `rank_tracker_create`, `rank_tracker_update`, `rank_tracker_get`, `rank_tracker_history`, `rank_tracker_list`, `rank_tracker_delete`, `rank_tracker_estimate`, `rank_tracker_run` |

## CHANGELOG (Added)

- **Rank tracker with history** (`rank_tracker_*`, CLI `ga4m rank-tracker-*`):
  - Persistent keyword sets per site, market and device, with pinned keywords.
  - A free cost estimate.
  - Gated runs: one live Google SERP per keyword, capped by `max_cost_usd` and the DataForSEO balance.
  - Each run stores the position, ranking URL, SERP features, AI Overview citation and top competitors, and reports the change versus the previous run.
  - Position history over time.
  - Scheduling stays in cron: `ga4m rank-tracker-run --site example.com --tracker-id <id>`.
