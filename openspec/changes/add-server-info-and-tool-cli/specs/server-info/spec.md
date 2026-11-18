# Spec Delta

## ADDED Requirements

### Requirement: Install introspection
The `server_info` tool SHALL return:
- `version` (from package.json);
- `ga4_cli.{path_usable, version}`;
- `tool_count` (the registry length);
- `groups[]` with `{id, title, status, reasons[], tools[{name, available, reason?}]}`;
- `credentials.{google, type}`, `state_dir`, `lookup_cache`, `spending_caps`, `write_mode`;
- an `update_hint` naming the update path for Desktop, npx and npm.

It SHALL make no network call unless `probe_scopes` is true.

#### Scenario: DataForSEO not configured
- **WHEN** DATAFORSEO_USERNAME or DATAFORSEO_PASSWORD is unset
- **THEN** the `dataforseo` group has status `disabled` and a reason naming the missing variables

#### Scenario: ga4 binary missing
- **WHEN** the ga4 binary is not executable
- **THEN** every `cli()`-backed tool is listed with `available: false` and a reason pointing to INSTALL.md, and `ga4_cli.path_usable` is false

#### Scenario: Scope not granted
- **WHEN** `probe_scopes` is true and the token for a group's scope lacks that scope
- **THEN** the group is `disabled` with a reason naming the scope

### Requirement: Every tool is grouped
Every registered tool SHALL belong to exactly one group in `tool-groups.ts`.

#### Scenario: New tool without a group
- **WHEN** a tool is registered but not listed in any group
- **THEN** `server-info.test.ts` fails
