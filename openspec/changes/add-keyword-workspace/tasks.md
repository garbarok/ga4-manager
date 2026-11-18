# Tasks

## 1. Workspace
- [x] 1.1 `keyword-workspace.ts`: snapshot store, upsert (tag merge/replace, note, metrics), list (tag/query/sort), remove (keywords/tag/untag). Verify with tests on a temp state dir.

## 2. Suggestions
- [x] 2.1 `keyword-suggestions.ts`: GSC site resolution (config or site), window ending 3 days ago, striking-distance selection excluding saved keywords. Verify that the free path makes no DataForSEO call.
- [x] 2.2 Paid `keywords_for_site` behind `gatePaidRun`, with the `in_gsc` flag. Verify with mocked fetch.

## 3. Competitive research
- [x] 3.1 `serp-competitors.ts`: keywords or saved tag, gate, mapping, site and known-competitor marks, suggestions. Verify the request body, mapping and estimate_only.
- [x] 3.2 `serp-locations.ts`: free country/language list, per-country regions, in-memory cache. Verify filtering and that repeated calls are cached.
- [x] 3.3 `domain-overview.ts`: overview + top pages, band summary, missing-data warning. Verify with fixtures. Live check: `ga4m domain-overview --domain example.com --estimate-only` priced the overview at the same $0.01212 DataForSEO billed for a captured call.

## 4. Registry and docs
- [x] 4.1 Register the specs and sync the manifest.
- [x] 4.2 README rows and CHANGELOG bullets in DOCS.md.
