# Tasks

## 1. Renderer
- [x] 1.1 `mcp/src/reports/render.ts`: escaping, safe markdown subset, data tables (row and column caps, number formatting, URL cells), CSS bar chart, full document with CSP, light/dark and viewport. Verify with `render.test.ts`, including `<script>` payloads in values, keys, titles, chart labels and links, `javascript:`/`data:` links, and quote break-out from an href.

## 2. Templates
- [x] 2.1 `mcp/src/reports/templates.ts`: built-in `monthly_seo_checkin`; global and per-site stores in the shared envelope; site templates hide global ones; built-ins read-only. Verify in `reports.test.ts`.

## 3. Tools
- [x] 3.1 `report_save` (sections | tool_output | template + section_data, optional intro), with atomic HTML + record writes. Verify with fixture tests in temp dirs.
- [x] 3.2 `report_list`, `report_get` (meta | path | html; newest by default), `report_delete` (both files; traversal-safe ids).
- [x] 3.3 `report_template_save`, `report_template_list`, `report_template_delete`.
- [x] 3.4 Register in `registry.ts` under "Saved reports (item 8)"; `pnpm exec tsx scripts/sync-manifest-tools.ts`. Verify `registry.test.ts`, `server-info.test.ts` (group membership) and CLI parity (`ga4m report-save ...`) pass.

## 4. Docs
- [x] 4.1 README tool-table rows and CHANGELOG bullets in `DOCS.md` for the parent change to merge.
