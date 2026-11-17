# Spec Delta

## ADDED Requirements

### Requirement: Cache paid lookups per site and parameters
Inside a dispatched tool call, a DataForSEO request SHALL first be looked up by sha256 of `{method, path, task}`, with task keys sorted. The lookup is in `<state_dir>/cache/<site|_unscoped>/`. On a hit within the TTL, it SHALL return the stored items with cost 0 and make no HTTP request. TTLs: AI answers 7 days, `serp/*` 6 hours, others 24 hours. Unbilled endpoints SHALL never be cached.

#### Scenario: Repeat within TTL
- **WHEN** the same keyword SERP is requested twice within 6 hours for the same site
- **THEN** the second call makes no request, reports cost 0, and the result has `cache.hits: 1` with the original `cached_at`

#### Scenario: Refresh
- **WHEN** `refresh_cache: true` is passed
- **THEN** the cache is not read, the request is made and billed, and the entry is rewritten

### Requirement: Cache-aware estimates
A cost estimate SHALL count requests that the cache would answer as `cached_requests` at $0.

#### Scenario: Fully cached run
- **WHEN** every planned request is cached
- **THEN** the estimate total is 0 and the balance check is skipped
