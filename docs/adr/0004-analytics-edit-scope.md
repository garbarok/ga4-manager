# ADR-0004: Use analytics.edit (not analytics) OAuth scope for write operations

**Status:** Accepted  
**Date:** 2026-03-xx

## Context

Early versions used the broad `https://www.googleapis.com/auth/analytics` scope for setup and cleanup operations. This scope is more permissive than needed and was causing silent auth failures in some ADC configurations because it is not always granted by default in `gcloud auth application-default login` flows.

## Decision

Use `https://www.googleapis.com/auth/analytics.edit` for all write operations (setup, cleanup, link). Use `https://www.googleapis.com/auth/analytics.readonly` for read-only operations (report, validate). Use `https://www.googleapis.com/auth/webmasters` for all Search Console operations.

The `scripts/setup.sh` script requests these exact scopes during the ADC auth flow.

## Consequences

- Principle of least privilege: read-only service accounts cannot accidentally run destructive operations.
- The `setup.sh` script must be re-run by users who authenticated with the old `analytics` scope — the script detects missing scopes and prompts accordingly.
- Any future scope additions (e.g. for BigQuery link creation if the API adds support) must be added to both `setup.sh` and this ADR.
