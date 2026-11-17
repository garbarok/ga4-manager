# Spec Delta

## ADDED Requirements

### Requirement: Every MCP tool is a CLI command
The `ga4m` bin SHALL run any registered tool by its name, with dashes or underscores. It SHALL validate input with the tool's zod schema through the same dispatcher as the MCP server, and print the tool's JSON result to stdout. Exit codes: 0 success, 1 tool error, 64 usage error.

#### Scenario: Flags coerced by schema
- **WHEN** `ga4m site-audit-run --start-url https://example.com/ --max-pages 50 --render-js` is run
- **THEN** the tool receives `{start_url: "https://example.com/", max_pages: 50, render_js: true}`

#### Scenario: Unknown flag
- **WHEN** a flag is not a property of the tool's input schema
- **THEN** ga4m exits 64 and suggests `ga4m help <tool>`

#### Scenario: Parity
- **WHEN** a tool is added to the registry
- **THEN** it is reachable as `ga4m <dashed-name>` with no further code (asserted by `cli.test.ts`)
