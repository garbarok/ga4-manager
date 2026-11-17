# ADR-0006: CLI parity for native tools, and native local state

**Status:** Accepted
**Date:** 2026-11-17

## Context

The OpenSEO-parity work adds about fifty tools. Most of them sit on code that exists only in the TypeScript MCP package: the DataForSEO client, the per-session spending cap, the GA4 Data API client, the HTML signal extractors and the PageSpeed client. The BACKLOG rule "CLI + MCP at parity from day one" was written when every stateful command was a Go GSC diagnostic. Since then, native tools (keyword research, AdSense, GA4 reports) have shipped with no CLI at all.

Two ways to restore parity were weighed:

- **Port every new feature to Go.** This means a second DataForSEO client, a second GA4 Data client, a second spending cap and a second HTML auditor. Design D1 of `close-growth-intelligence-gaps` already rejected a Go GA4 Data client for this reason.
- **Make the registry the CLI.** ADR-0003 already makes `SPECS` the single source of truth for what a tool is: name, input schema, handler. A command-line front end over the same registry gives every tool a CLI command with the same validation and the same output, and a tool cannot exist in one place but not the other.

## Decision

1. **`ga4m` is the CLI for MCP tools.** The npm package ships a second bin, `ga4m`. It runs any registered tool: `ga4m <tool> --flag value`, `ga4m <tool> --input '<json>'`, `ga4m help <tool>`, `ga4m list`. Flags are coerced with the tool's JSON schema. Dashes and underscores are interchangeable in names. The output is the tool's JSON result. The `ga4` Go binary remains the CLI for config-driven GA4 admin work and the GSC diagnostics. MCP tools that wrap it (`cli()` specs) are also reachable through `ga4m`.

2. **One dispatch path.** `src/dispatch.ts` runs a tool for both front ends. It applies the write gate, validates input, runs the tool inside a per-call context, and adds cache and research-log facts to the result. `index.ts` and `cli.ts` contain no dispatch logic of their own.

3. **Native tools write state under the ADR-0005 envelope.** `src/utils/state-store.ts` writes the same `{schema_version, command, site, generated_at, data}` envelope as `internal/gsc/state`, also atomically (temp file + rename). The two layouts:
   - snapshots: `<state_dir>/<command>.<site>.json`, e.g. project context;
   - collections: `<state_dir>/<collection>/<site>/<id>.json`, e.g. audits, tracker runs, reports and cache entries.

   `<site>` is the lowercase host (`sc-domain:example.com` → `example.com`).

4. **State directory resolution.** In order:
   1. `state_dir` input / `--state-dir`;
   2. `GA4M_STATE_DIR`;
   3. `.ga4-state/` next to the `config` file when one is given;
   4. `.ga4-state/` in the working directory, unless that is `/` or not writable (Claude Desktop starts servers in `/`);
   5. `~/.ga4-state/`.

5. **Paid calls go through a gate, a cache and a log.**
   - **Gate.** Every new DataForSEO-spending tool lists the requests it would make. It prices them from DataForSEO's own price list (`appendix/user_data`, free) and reads the balance from the same call. It refuses when the estimate exceeds `max_cost_usd` or the balance. With `estimate_only` it returns the estimate without spending.
   - **Cache.** `dataforseoRequest` reads and writes a per-site lookup cache, but only inside a dispatched call.
   - **Log.** The dispatcher appends billed requests to the site's research log in its project context.

   Existing DataForSEO tools gain the cache and the log without code changes. They keep only the session cap; they do not have the estimate gate.

## Consequences

- Every tool gets a CLI command and an MCP tool from one definition. `cli.test.ts` asserts that every registered tool resolves from its dashed CLI name.
- Two CLIs exist: `ga4` for YAML-driven admin and GSC diagnostics, and `ga4m` for everything in the registry. INSTALL.md documents both.
- The Go process stays the single writer of the files it owns. Native tools write their own files. No file has two writers, so ADR-0005's no-locking stance holds.
- Background jobs (the site crawler) run as a detached `ga4m` process that writes progress into its own state record. Status tools only read that record.
