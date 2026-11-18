# GA4 Manager

> **Automate Google Analytics 4 + Search Console at scale**

A CLI + MCP server for managing GA4 properties, Search Console sites, sitemaps, and SEO audits from YAML configuration files or directly from your AI assistant.

[![npm](https://img.shields.io/npm/v/ga4-manager-mcp)](https://www.npmjs.com/package/ga4-manager-mcp)
[![Latest Release](https://img.shields.io/github/v/release/garbarok/ga4-manager)](https://github.com/garbarok/ga4-manager/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

- **GA4 ops** — bulk-create conversion events, custom dimensions, custom metrics, audiences from YAML; clean up unused resources; validate configurations
- **Search Console ops** — manage sitemaps, query search analytics, inspect URL indexing, generate coverage reports
- **SEO audits** — on-page audit with title/meta/canonical/schema/redirect checks plus optional Core Web Vitals
- **Traffic diagnostics** — compare GSC traffic between two date ranges per URL to find biggest drops and gains
- **Consent mode health** — report grant/deny rates and banner-bypass for GA4 sessions
- **SEO workspace** — site crawl audits with Lighthouse, Search Console × GA4 page opportunities, change-impact verdicts, rank and AI-visibility tracking, keyword workspace, competitor research, saved HTML reports and per-site project memory
- **MCP server + `ga4m` CLI** — every tool is both an MCP tool (Claude Desktop, Claude Code, VS Code, Cursor, Cline) and a `ga4m` command

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

## MCP server and `ga4m` CLI

Register the server with your AI client and it can run any of these tools directly. Every tool is also a terminal command through `ga4m`, with the same input and output: `ga4m list`, `ga4m help <tool>`, `ga4m site-audit-run --start-url https://example.com/` ([ADR-0006](docs/adr/0006-native-tool-cli-parity-and-local-state.md)). `server_info` reports the installed version and which tool groups are enabled, and why a group is off.

| Group | Tools |
|-------|-------|
| Start here | `server_info`, `project_context_get`, `project_context_update`, `site_growth_brief` |
| GA4 ops | `ga4_setup`, `ga4_report`, `ga4_cleanup`, `ga4_link_list`, `ga4_link_create`, `ga4_link_remove`, `ga4_validate`, `ga4_annotations` |
| GA4 reports | `ga4_traffic_report`, `ga4_consent_health`, `ga4_organic_overview`, `ga4_organic_landing_pages`, `ga4_key_events`, `ga4_traffic_acquisition`, `ga4_audience`, `ga4_site_search`, `ga4_ecommerce`, `ga4_measurement_health` |
| Search Console ops | `gsc_sitemaps_list`, `gsc_sitemaps_submit`, `gsc_sitemaps_delete`, `gsc_sitemaps_get`, `gsc_inspect_url`, `gsc_monitor_urls`, `gsc_index_coverage` |
| Search Console analysis | `gsc_analytics_run`, `gsc_traffic_compare`, `gsc_change_impact`, `page_opportunities`, `gsc_opportunities`, `gsc_ctr_anomaly`, `gsc_decay`, `gsc_cannibalization`, `gsc_url_hygiene`, `gsc_hreflang`, `gsc_health` |
| Site audits | `site_audit_run`, `site_audit_status`, `site_audit_issues`, `site_audit_pages`, `site_audit_lighthouse`, `site_audit_list`, `site_audit_delete`, `seo_page_audit`, `seo_audit_batch` |
| Keyword research | `keyword_suggestions`, `keyword_ideas`, `keyword_volume`, `keyword_serp_snapshot`, `keyword_gap`, `ranked_keywords`, `google_trends`, `serp_locations` |
| Keyword workspace | `keywords_save`, `keywords_list`, `keywords_remove` |
| Rank tracking | `rank_tracker_create`, `rank_tracker_update`, `rank_tracker_get`, `rank_tracker_history`, `rank_tracker_list`, `rank_tracker_delete`, `rank_tracker_estimate`, `rank_tracker_run`, `keyword_rank_check` |
| Competitors | `serp_competitors`, `domain_overview`, `backlinks_overview`, `link_gap` |
| AI visibility | `llm_mentions`, `ai_visibility_research`, `ai_visibility_prompts_generate`, `ai_visibility_tracker_save`, `ai_visibility_estimate`, `ai_visibility_explore`, `ai_visibility_run`, `ai_visibility_results`, `ai_visibility_trend`, `ai_visibility_sources`, `ai_visibility_answer`, `ai_visibility_export` |
| Saved reports | `report_save`, `report_list`, `report_get`, `report_delete`, `report_template_save`, `report_template_list`, `report_template_delete` |
| AdSense | `adsense_accounts_list`, `adsense_report` |
| Indexing | `indexnow_submit` |
| DataForSEO account | `dataforseo_balance`, `dataforseo_request` (gated raw escape hatch) |

**Prompts:**
- Monitoring: `daily_briefing`, `weekly_review`, `core_update_check`.
- Workflows: `project_setup`, `seo_audit`, `keyword_research`, `keyword_clustering`, `competitor_analysis`, `competitive_landscape`, `ai_visibility_audit`, `monthly_report`.

**Paid lookups** (DataForSEO, ValueSERP) are opt-in and capped in three layers:
- Every new paid tool takes `estimate_only` and `max_cost_usd`, and checks the account balance before spending.
- Repeats are answered from a local per-site cache: 6 h for SERPs, 24 h for Labs data, 7 days for AI answers.
- Billed lookups are logged in the site's project context, so the next agent does not buy them again.

State (project context, audits, trackers, reports, cache) lives in `.ga4-state/` next to your config.

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
>
> "Audit https://example.com/ and tell me the five fixes that matter most." (or run the `seo_audit` prompt)
>
> "Which pages ranking 4–20 bring the visitors who convert?" (`page_opportunities`)
>
> "Did the title rewrite on /blog/ on 2026-10-01 work?" (`gsc_change_impact`)

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
