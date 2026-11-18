# Tasks

## 1. Dispatcher and CLI
- [x] 1.1 Extract binary resolution to `src/binary.ts` and dispatch to `src/dispatch.ts`; `index.ts` calls `dispatchTool`. Verify the existing suite stays green.
- [x] 1.2 Add `src/cli.ts` (`ga4m`) with list/help/run, schema-driven flag coercion, `--input`/`--input-file`. Verify with `cli.test.ts` (coercion, unknown flag, parity over all specs, run server-info).
- [x] 1.3 Add `bin.ga4m` to package.json.

## 2. server_info
- [x] 2.1 `src/tool-groups.ts` with requirements per group. Verify that every registered tool is in a group.
- [x] 2.2 `tools/server-info.ts`: group evaluation (env, credentials file, binary, write gate, optional scope probe). Verify with `server-info.test.ts`.
- [x] 2.3 Live: `ga4m server-info` on this machine lists all groups with reasons.

## 3. Docs
- [x] 3.1 INSTALL.md "Updating" (Desktop .mcpb, npx @latest + cache reset, npm -g, ga4 binary).
- [x] 3.2 ADR-0006.
- [x] 3.3 `manifest:sync` script; the manifest lists every registered tool.
