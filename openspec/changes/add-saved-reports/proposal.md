# Proposal

## Why

OpenSEO lets an agent save a report from any finding, reopen it later, reuse report templates (for example a monthly SEO check-in), and share the result. GA4 Manager can produce every input such a report needs, but each tool output is gone at the end of the conversation, and nothing turns it into something an Operator can send to a client or a colleague.

## What Changes

- **New `report_save` tool** (CLI: `ga4m report-save`). It writes one self-contained HTML file from any tool output, stored per site in the state dir. The input is exactly one of:
  - explicit `sections` (markdown, data, bar chart);
  - a single `tool_output`;
  - a `template` filled from `section_data`.

  The page needs no network and no JavaScript. Every value is HTML-escaped, and a Content-Security-Policy forbids scripts and remote loads, because tool outputs carry untrusted text (crawled titles, AI answers).
- **New `report_list`, `report_get` and `report_delete` tools.**
  - `report_list` returns reports newest first, optionally for one site.
  - `report_get` returns metadata, the file path, or the full HTML.
  - `report_delete` removes both the record and the HTML.
- **Sharing is by file.** `report_get` returns the absolute `.html` path or the HTML text. The Operator sends the file, or an assistant publishes it. Nothing is uploaded: the tool has no hosting, and uploading Operator data was not asked for.
- **Report templates.** `report_template_save`, `report_template_list` and `report_template_delete` manage reusable section lists: heading, instructions, and an optional tool with suggested input. Templates are global or per site; a site template hides a global one with the same name. The built-in, read-only `monthly_seo_checkin` chains `ga4_organic_overview`, `gsc_analytics_run`, `page_opportunities`, `site_audit_issues`, `rank_tracker_get`, `ai_visibility_trend` and `project_context_get`, then a written summary.

## Capabilities

### New Capabilities
- `saved-reports`: rendering, storing, listing, sharing and templating HTML reports.

## Impact

- New files:
  - `mcp/src/reports/render.ts`, a pure HTML renderer;
  - `mcp/src/reports/templates.ts`, the template store and built-ins;
  - `mcp/src/tools/reports.ts`, seven `native()` specs registered in `registry.ts`;
  - tests next to each.
- State (ADR-0005 envelope, ADR-0006 layout):
  - `<state_dir>/reports/<site>/<id>.json` plus `<id>.html`;
  - `<state_dir>/report-templates.json` (global);
  - `<state_dir>/report-templates.<site>.json` (per site).
- No API calls, scopes, costs or new dependencies. All seven tools are in the `local_state` group.
