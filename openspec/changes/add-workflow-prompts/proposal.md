# Proposal

## Why

OpenSEO ships 12 agent skills that chain its tools into routines. GA4 Manager has three monitoring prompts (daily briefing, weekly review, core update check). It has no prompts for the SEO workflows the new tools exist for. Without them, every agent reinvents the order of calls and the spending discipline, and the paid steps are where that goes wrong.

## What Changes

Eight new MCP prompts in `mcp/src/workflow-prompts.ts`, listed in `prompts/list` after the monitoring prompts:

| Prompt | Chains | Paid |
|--------|--------|------|
| `project_setup` | project_context_get → site_audit_run/status/pages → gsc_analytics_run → ga4_organic_landing_pages, ga4_key_events, ga4_measurement_health → project_context_update | no |
| `seo_audit` | site_audit_list → site_audit_run (+Lighthouse) → status → issues → lighthouse → gsc_url_hygiene, gsc_cannibalization, gsc_index_coverage → report_save | no |
| `keyword_research` | project_context_get → keyword_suggestions → serp_locations → keyword_ideas → ranked_keywords, keyword_gap → keyword_volume → keywords_save | yes |
| `keyword_clustering` | keywords_list → rank_tracker_create/estimate/run (top-10 SERPs) → SERP-overlap clusters → rank_tracker_get, gsc_cannibalization → keywords_save tags, project_context_update key pages | yes |
| `competitor_analysis` | domain_overview ×2 → keyword_gap → backlinks_overview → link_gap → seo_page_audit → project_context_update, keywords_save | yes |
| `competitive_landscape` | keywords_list / keyword_suggestions → serp_competitors → domain_overview → project_context_update | yes |
| `ai_visibility_audit` | project_context_get → ai_visibility_prompts_generate → ai_visibility_research → ai_visibility_tracker_save → estimate → run → results, sources, trend | yes |
| `monthly_report` | report_template_list → ga4_organic_overview → gsc_analytics_run → page_opportunities → gsc_change_impact → site_audit_status → rank_tracker_get, ai_visibility_trend → report_save (monthly_seo_checkin) | no |

Every paid workflow carries the same spending rules:
- read the research log first and do not re-buy;
- call `dataforseo_balance` once;
- run each paid tool with `estimate_only: true` before running it for real;
- stop and ask above $2 per workflow.

## Capabilities

### New Capabilities
- `workflow-prompts`

## Impact

- New: `mcp/src/workflow-prompts.ts` and its test.
- `mcp/src/prompts.ts` lists the new prompts and dispatches to them; the monitoring prompts are unchanged.
- A test checks that every tool a workflow or the built-in report template names is registered.
