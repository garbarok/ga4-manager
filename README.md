# GA4 Manager

> **Automate Google Analytics 4 + Search Console at scale**

A CLI + MCP server for managing GA4 properties, Search Console sites, sitemaps, and SEO audits from YAML configuration files or directly from your AI assistant.

[![Test Status](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/test.yml)
[![Security](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/security.yml)
[![Release](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml/badge.svg)](https://github.com/garbarok/ga4-manager/actions/workflows/release.yml)
[![Go Report Card](https://goreportcard.com/badge/github.com/garbarok/ga4-manager)](https://goreportcard.com/report/github.com/garbarok/ga4-manager)
[![Latest Release](https://img.shields.io/github/v/release/garbarok/ga4-manager)](https://github.com/garbarok/ga4-manager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

- **GA4 ops** — bulk-create conversion events, custom dimensions, custom metrics, audiences from YAML; clean up unused resources; validate configurations
- **Search Console ops** — manage sitemaps, query search analytics, inspect URL indexing, generate coverage reports
- **SEO audits** — on-page audit with title/meta/canonical/schema/redirect checks plus optional Core Web Vitals
- **Traffic diagnostics** — compare GSC traffic between two date ranges per URL to find biggest drops and gains
- **Consent mode health** — report grant/deny rates and banner-bypass for GA4 sessions
- **MCP server** — 16 tools surfaced to Claude Desktop, Claude CLI, VS Code, Cursor, Cline

Define your analytics setup in YAML, apply with one command. Or talk to your assistant.

---

## 30-second setup

```bash
git clone https://github.com/garbarok/ga4-manager.git
cd ga4-manager
./scripts/setup.sh
```

The setup script:

- Verifies prerequisites (`gcloud`, `jq`, `curl`)
- Picks the auth path with you (ADC user creds for personal use, or a service account key for CI)
- Runs `gcloud auth ...` with all required scopes
- Sets the GCP quota project and enables the four required APIs
- Smoke-tests every API and reports green/red
- Prints exactly which manual permission grants you still need (Search Console + GA4 add-user steps)

Re-runnable. Idempotent.

If you'd rather wire things up by hand, see [INSTALL.md](INSTALL.md) and [mcp/PERMISSIONS.md](mcp/PERMISSIONS.md).

If anything fails, [mcp/TROUBLESHOOTING.md](mcp/TROUBLESHOOTING.md) maps every error message to the exact fix.

---

## CLI

After setup, the binary is on your PATH (or build from source: `make build`).

```bash
ga4 --help                                  # all commands
ga4 init                                    # interactive credential wizard
ga4 validate --config configs/site.yaml     # YAML check
ga4 setup    --config configs/site.yaml --dry-run
ga4 setup    --config configs/site.yaml     # apply
ga4 report   --property-id 123456789 --days 28
ga4 gsc whoami      --config configs/site.yaml   # identity + per-property permissions
ga4 gsc audit-urls  --config configs/site.yaml   # probe indexed + sitemap URLs for 404s/redirects
```

YAML structure and field reference: [configs/examples/README.md](configs/examples/README.md).

---

## MCP server (17 tools)

Register the server with your AI client and Claude can run any of these directly.

| Group | Tools |
|-------|-------|
| GA4 ops | `ga4_setup`, `ga4_report`, `ga4_cleanup`, `ga4_link`, `ga4_validate` |
| GSC ops | `gsc_sitemaps_list`, `gsc_sitemaps_submit`, `gsc_sitemaps_delete`, `gsc_sitemaps_get`, `gsc_inspect_url`, `gsc_analytics_run`, `gsc_monitor_urls`, `gsc_index_coverage` |
| Diagnostics & SEO | `gsc_traffic_compare`, `ga4_consent_health`, `seo_page_audit`, `seo_audit_batch` |

### Setup

- **Claude Desktop / CLI / VS Code / Cursor / Cline** — see [mcp/CONFIGURATION.md](mcp/CONFIGURATION.md) for client-by-client config snippets.
- **Tool reference + examples** — [mcp/README.md](mcp/README.md).
- **Per-resource permissions** (which tool needs which OAuth scope and which property/site grant) — [mcp/PERMISSIONS.md](mcp/PERMISSIONS.md).

### Example prompts

> "Compare last week's GSC traffic to the prior week for `sc-domain:example.com` and show the biggest drops."
>
> "Audit `https://example.com/pricing` and report on-page SEO issues. Include Core Web Vitals."
>
> "What's the consent banner accept rate on property 123456789 over the last 30 days?"

---

## Documentation

| Document | When to read |
|----------|--------------|
| [INSTALL.md](INSTALL.md) | Detailed binary install + manual credential setup |
| [mcp/CONFIGURATION.md](mcp/CONFIGURATION.md) | Wiring the MCP server into a specific client |
| [mcp/README.md](mcp/README.md) | Tool-by-tool reference with example inputs/outputs |
| [mcp/PERMISSIONS.md](mcp/PERMISSIONS.md) | ADC vs service account, OAuth scopes, per-resource grants |
| [mcp/TROUBLESHOOTING.md](mcp/TROUBLESHOOTING.md) | Every error message you might see → exact fix |
| [configs/examples/README.md](configs/examples/README.md) | YAML structure reference |
| [docs/ERRORS_AND_FAQ.md](docs/ERRORS_AND_FAQ.md) | CLI error reference |
| [SECURITY.md](SECURITY.md) | Credential management practices |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [CONTRIBUTING.md](.github/CONTRIBUTING.md) | How to contribute |

---

## Status & limitations

- **Audiences** — manual creation only (GA4 Admin API does not support programmatic audience creation)
- **Search Console user grants** — manual only (no API available)
- **BigQuery links** — list/retrieve only, no create via API
- **Channel groups** — fully supported

---

## Contributing

Issues, PRs, and discussions are welcome. Run `make test && make lint` before submitting.

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full guide.

---

## License

MIT — see [LICENSE](LICENSE).
