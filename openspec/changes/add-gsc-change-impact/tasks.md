# Tasks

- [x] 1. Pure window, metric, delta and verdict functions. Verify with `gsc-change-impact.test.ts` (equal windows, shrink at data_through, impression-weighted position, the full verdict table).
- [x] 2. `changesFromAnnotations` (URL/path scoping, system ones skipped, date ranges). Verify with a fixture test.
- [x] 3. Tool with filtered Search Analytics queries, overlap detection and quota count. Verify with a fetch-mocked test (prefix regex, too_early for a recent change).
- [x] 4. Live dry run with real GA4 annotations and manual changes. Redacted record in `LIVE_RUN.md`. The run found that path prefixes built from the apex host missed `www.` pages; they now match any host.
