# Docs to merge (item 8)

## README tool table row

| Saved reports | `report_save`, `report_list`, `report_get`, `report_delete`, `report_template_save`, `report_template_list`, `report_template_delete` |

## mcp/README.md section

### Saved reports

Turn any tool output into one self-contained HTML file per site (inline CSS, no scripts or remote resources, light/dark, phone-friendly). Untrusted text from crawled pages and AI answers is always HTML-escaped.

- `report_save`: `site`, `title`, and one of `sections` [{heading, markdown?, data?, chart?}], `tool_output`, or `template` + `section_data` {heading: output}. Returns `id`, `path` (the .html file) and `size_bytes`.
- `report_list` / `report_get` (`format`: meta | path | html) / `report_delete`.
- `report_template_save` / `report_template_list` / `report_template_delete`: reusable section lists, global or per site. Built-in: `monthly_seo_checkin`.

Sharing is by file: send the `.html`, or have the assistant publish the HTML from `report_get` with `format: "html"`. Nothing is uploaded.

CLI: `ga4m report-save --site example.com --title "May check-in" --tool-output '{...}'`.

## CHANGELOG bullets (Unreleased → Added)

- Saved reports: `report_save` writes a self-contained, script-free HTML report from any tool output per site (`.ga4-state/reports/<site>/`). `report_list`, `report_get` (meta, path or HTML for sharing) and `report_delete` manage saved reports.
- Report templates: `report_template_save`, `report_template_list` and `report_template_delete`, global or per site. The built-in `monthly_seo_checkin` chains organic traffic, top queries, page opportunities, audit issues, rank tracking, AI visibility and the research log.
