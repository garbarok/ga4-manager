# GA4 Manager

CLI tool for managing Google Analytics 4 properties via the Admin API.
Uses `make` for build/test. MCP server in `mcp/` uses npm.

## Environment

Requires `.env` with `GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_CLOUD_PROJECT`.

## Constraints

See [`docs/agents/ga4-constraints.md`](docs/agents/ga4-constraints.md) for GA4 API limitations and permanently-reserved parameter names.
