# Tasks

## 1. Model
- [x] 1.1 `rank-tracker-core.ts`: tracker creation and keyword ops, run planning, SERP parsing (goto-wrapper hosts, AI Overview references), run comparison, history. Verify with pure tests.
- [x] 1.2 Shared `utils/site-input.ts` (site/config/state_dir inputs, store resolution, error guard).

## 2. Tools
- [x] 2.1 create/update/get/history/list/delete (local). Verify with tool tests on a temp state dir.
- [x] 2.2 `rank_tracker_estimate` via `estimatePlan`. Verify that only the free user_data call is made.
- [x] 2.3 `rank_tracker_run` via `gatePaidRun`, 5 concurrent SERPs, stored run, comparison. Verify the gate refusal, success, second-run `lost`, and all-failed paths with mocked fetch.
- [x] 2.4 Register the specs and sync the manifest.

## 3. Docs
- [x] 3.1 README rows and CHANGELOG bullets in DOCS.md (merged by the integrating change).
