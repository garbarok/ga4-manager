# Proposal

## Why

Installed clients lag behind the registry. A Claude Desktop install was seen exposing about 29 tools, without gsc_decay, gsc_hreflang, gsc_url_hygiene, ga4_traffic_report, site_growth_brief, keyword_*, llm_mentions, indexnow_submit or ga4_annotations. From inside the client an agent cannot tell an old install from a group switched off by missing credentials.

Separately, the BACKLOG rule "CLI + MCP at parity" has drifted: every native tool (DataForSEO, AdSense, GA4 Data API) is reachable only over MCP. The OpenSEO-parity work adds about fifty more native tools, so parity needs a mechanism, not a per-tool promise.

## What Changes

- **New `server_info` MCP tool** (CLI: `ga4m server-info`). It returns:
  - server version and `ga4` CLI version;
  - tool count;
  - every tool group with status `enabled | degraded | disabled` and the reason (missing `DATAFORSEO_*`, missing Google credentials or scope, no `ga4` binary, read-only mode, destructive opt-in);
  - the resolved state dir, lookup-cache status, spending caps and an update hint.

  `probe_scopes: true` additionally checks each Google scope was granted.
- **New `ga4m` bin** in the npm package. It runs any registered tool from the command line through the same dispatcher as the MCP server: `ga4m list`, `ga4m help <tool>`, `ga4m <tool> --flag value | --input JSON`.
- **Shared dispatcher** (`src/dispatch.ts`) used by `index.ts` and `cli.ts`.
- **Tool groups** (`src/tool-groups.ts`). Every tool belongs to one group; a test enforces this.
- **Manifest sync script** (`pnpm manifest:sync`), so the `.mcpb` tool list is generated from the registry.
- **INSTALL.md "Updating"** for Claude Desktop (.mcpb), npx (`@latest`, cache reset), global npm and the `ga4` binary.
- **ADR-0006** records the parity mechanism and native state layout.

## Capabilities

### New Capabilities
- `server-info`: install introspection and group status.
- `tool-cli`: the `ga4m` command line over the tool registry.

## Impact

- `mcp/src/index.ts` loses its inline dispatch. `mcp/src/dispatch.ts`, `cli.ts`, `binary.ts`, `tool-groups.ts` and `tools/server-info.ts` are new.
- `mcp/package.json` gains `bin.ga4m` and the `manifest:sync` script.
- No new scopes or dependencies.
