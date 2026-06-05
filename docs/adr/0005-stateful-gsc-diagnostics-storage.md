# ADR-0005: Project-local JSON state for diff-based GSC diagnostics

**Status:** Accepted
**Date:** 2026-06-05

## Context

BO-03 (weekly index health) and other planned GSC diagnostics need to compare each run against the previous one — newly de-indexed pages, coverage regressions, canonical mismatches. The project has been pure-function up to now; this is the first persistent state.

## Decision

State files live at `.ga4-state/` next to the config, gitignored by default. A `--state-dir` flag overrides the location for cron-as-service-account setups that need a persistent volume.

One JSON file per `(command, gsc_site)` pair, named `<command>.<gsc-site-with-colon-replaced>.json`. Atomic writes (write-to-temp + rename). Every file begins with a schema envelope:

```json
{
  "schema_version": 1,
  "command": "health",
  "site": "sc-domain:wealthsim.app",
  "generated_at": "2026-06-05T12:00:00Z",
  "data": { ... }
}
```

The loader rejects unknown `schema_version` values with a clear "upgrade or delete and rebaseline" error.

## Considered Options

- **User-home (`~/.ga4-manager/state/`)**: rejected. Doesn't match the project-anchored, config-driven shape of the rest of the tool. Multi-user / CI-as-service-account scenarios collide unless namespaced.
- **SQLite**: rejected for v1. Diagnostics only need previous-vs-current snapshot, not queryable history. A single JSON snapshot is human-readable, diffable in PRs (when checked in), and trivially atomic.
- **NDJSON append-only log**: rejected for v1 for the same reason. A future `.ga4-state/history/<command>.<site>.ndjson` can sit alongside the snapshot file if audit history becomes a requirement.

## Consequences

- `.gitignore` must list `.ga4-state/` by default; the `init` command should add it if missing.
- Adding a new stateful command means picking a `command` slug and writing a file under the same directory — no new infrastructure.
- Schema migrations are explicit: bump `schema_version`, write a migrator, or instruct users to delete and rebaseline. There is no auto-migration of unknown versions.
- MCP tools (per Q1 parity rule) read/write the same files via the CLI binary; the Go process is the single writer per invocation, so no cross-process locking is needed beyond atomic rename.
