# GA4 Manager

CLI tool for managing Google Analytics 4 properties via the Admin API.
Uses `make` for build/test. MCP server in `mcp/` uses npm.

## Non-obvious Constraints

**Archived GA4 parameters are permanently reserved** — you cannot reuse a parameter name once archived. Workaround: use new names (e.g. `user_type_v2`) or un-archive via GA4 UI.

**API Limitations**:
- Audiences: manual creation only (API unsupported)
- Search Console Links: manual only (API unsupported)
- BigQuery Links: list/retrieve only, no create via API
- Channel Groups: fully supported

## Environment

Requires `.env` with `GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_CLOUD_PROJECT`.
