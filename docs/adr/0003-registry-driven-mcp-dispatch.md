# ADR-0003: Registry-driven MCP tool dispatch

**Status:** Accepted  
**Date:** 2026-04-25

## Context

The MCP server started with per-tool `if/else` dispatch: each tool had its own branch in a central handler. As the tool count grew toward 16, this produced repetitive validation and error-handling boilerplate and made adding new tools error-prone.

## Decision

Replace per-tool dispatch with a `SPECS` registry — an array of `CliToolSpec | NativeToolSpec` entries, each carrying the tool name, input schema, and execution strategy. A `SPEC_BY_NAME` map provides O(1) lookup. All validation, error wrapping, and response shaping run through shared middleware; only the execution closure differs per tool.

This refactor landed in commit `f006054`.

## Consequences

- Adding a new tool requires one registry entry and one handler function — no changes to the dispatch loop.
- CLI-backed tools and native TypeScript tools share the same error contract (`success` / `warnings` / `error: { code, message, hint }`).
- The registry is the authoritative list of available tools; the count in documentation should be derived from it.
