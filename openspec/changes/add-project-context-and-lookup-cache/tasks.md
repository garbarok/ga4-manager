# Tasks

## 1. Store and log
- [x] 1.1 `project-context-store.ts`: load/save, `researchEntries`, `appendResearch` (cap 500), `logResearch` (never throws).
- [x] 1.2 Dispatcher `decorate()`: append billed lookups; report `research_log` and `cache`. Verify with `dispatch.test.ts`.

## 2. Tools
- [x] 2.1 `project_context_get` with research summary and `missing`. Verify with `project-context.test.ts`.
- [x] 2.2 `project_context_update` with ordered all-or-nothing patch operations and `dry_run`. Verify with tests for every target and the failure index.

## 3. Lookup cache
- [x] 3.1 `lookup-cache.ts` (stable hash, TTL by endpoint family, env overrides).
- [x] 3.2 Wire into `dataforseoRequest` only inside a tool context; record lookups. Verify with `paid-gate.test.ts` (hit at $0, refresh bypass, no cache outside a context).
- [x] 3.3 Cache-aware `priceRequests`. Verify with an estimate test.
