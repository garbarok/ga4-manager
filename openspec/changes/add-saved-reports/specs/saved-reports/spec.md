# Spec Delta

## Purpose

Turns any tool output into a durable, shareable HTML report per site, with reusable templates.

## ADDED Requirements

### Requirement: Self-contained, safe HTML
`report_save` SHALL accept `site` and `title`, plus exactly one of `sections`, `tool_output` or `template`. It SHALL write one HTML document that:
- loads no remote resource and contains no script;
- carries a Content-Security-Policy of `default-src 'none'`;
- supports light and dark color schemes;
- fits phone widths.

Every string from the input SHALL be HTML-escaped: titles, headings, table keys and cells, chart labels, markdown text. Markdown SHALL support only headings, paragraphs, bold, italic, inline code, lists and links. Links SHALL be emitted only for `http`/`https` URLs, with `rel="noopener noreferrer nofollow"`.

#### Scenario: Untrusted text in a tool output
- **WHEN** a tool output contains `<script>alert(1)</script>` in a value or key
- **THEN** the saved HTML contains it only as escaped text, and contains no `<script` tag

#### Scenario: Non-http link in markdown
- **WHEN** markdown contains `[x](javascript:alert(1))`
- **THEN** no anchor is emitted for it

### Requirement: Data rendering
An array of objects SHALL render as a table whose columns are the union of keys (at most 12) and at most 200 rows, with a note when truncated. An object SHALL render as a key/value table, nesting up to 3 levels. Numbers SHALL be formatted with thousands separators. Cells that are http(s) URLs SHALL be links. A `chart` `{labels, values, title?, unit?}` SHALL render as horizontal bars in plain HTML and CSS.

#### Scenario: Large result
- **WHEN** a section's data has 205 rows
- **THEN** 200 rows are rendered, followed by "Showing 200 of 205 rows."

### Requirement: Per-site storage
A saved report SHALL be stored as `<state_dir>/reports/<site>/<id>.json` (metadata in the shared state envelope: id, title, site, created_at, template, per-section summary, html_file, size_bytes) and `<id>.html`, both written atomically. `<site>` is the normalized host. `report_save` SHALL return the id, the absolute HTML path, `size_bytes` and the headings of template sections not filled.

#### Scenario: Save from a tool output
- **WHEN** `report_save` is called with `site: "sc-domain:example.com"` and a `tool_output`
- **THEN** `reports/example.com/<id>.json` and `<id>.html` exist and the result's `path` points to the HTML file

### Requirement: List, get, delete, share
`report_list` SHALL return reports newest first, filtered by `site` when given and across all sites otherwise. `report_get` SHALL return the newest report when `id` is omitted. With `format` it SHALL return:
- `meta`: metadata plus path;
- `path`: the same;
- `html`: the same plus the HTML text.

`report_delete` SHALL remove the record and the HTML. Ids SHALL be validated against path traversal. Sharing SHALL NOT upload anything.

#### Scenario: Share the latest report
- **WHEN** `report_get` is called with `site` and `format: "html"`
- **THEN** it returns the newest report's HTML text and its absolute file path

#### Scenario: Traversal id
- **WHEN** `report_delete` is called with `id: "../../etc"`
- **THEN** it returns `INVALID_INPUT` and touches no file

### Requirement: Templates
A template SHALL be `{name, title, description, sections[{heading, instructions, tool?, tool_input?}]}` with unique headings. `report_template_save` SHALL store it globally, or per site when `site` is given. `report_template_list` SHALL return built-ins, then global templates, then the site's templates; a site template hides a global one with the same name. The built-in `monthly_seo_checkin` SHALL be listed with `read_only: true`, and SHALL NOT be overwritten or deleted. `report_save` with `template` SHALL fill sections from `section_data` keyed by heading (string → markdown, anything else → data). Unfilled sections SHALL render a "Not run" notice naming the tool. Headings the template does not define SHALL be rejected.

#### Scenario: Partially filled monthly check-in
- **WHEN** `report_save` uses `monthly_seo_checkin` with data for "Top search queries" only
- **THEN** the report renders that section's table, every other section shows a "Not run" notice with its tool, and `not_run` lists those headings

#### Scenario: Built-in protected
- **WHEN** `report_template_delete` is called for `monthly_seo_checkin`
- **THEN** it returns `INVALID_INPUT`
