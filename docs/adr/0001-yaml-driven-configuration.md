# ADR-0001: YAML-driven configuration as the primary interface

**Status:** Accepted  
**Date:** 2025-11-22

## Context

GA4 properties require many resources — conversion events, custom dimensions, custom metrics — to be kept in sync across environments. Without a declarative format, operators must either use the GA4 UI (error-prone, not auditable) or write imperative scripts (not reusable).

## Decision

All GA4 resource definitions are expressed in YAML config files (`configs/*.yaml`). The `ga4 setup` command reads the file and applies it idempotently. The YAML schema maps directly to `internal/config/ProjectConfig`.

## Consequences

- Config files can be reviewed, version-controlled, and diffed like code.
- Setup is idempotent: re-running against an existing property skips resources that already exist.
- The `--dry-run` flag lets operators preview changes before applying.
- Audiences cannot be expressed in YAML (GA4 Admin API does not support programmatic audience creation); this is documented as a known limitation.
