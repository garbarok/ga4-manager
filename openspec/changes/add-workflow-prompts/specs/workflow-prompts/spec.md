# Spec Delta

## ADDED Requirements

### Requirement: Eight workflow prompts
The server SHALL list, and return via `prompts/get`, the prompts project_setup, seo_audit, keyword_research, keyword_clustering, competitor_analysis, competitive_landscape, ai_visibility_audit and monthly_report. Each SHALL take `site` (a domain; scheme, `www.` and `sc-domain:` are stripped) plus its own arguments. Required arguments SHALL be validated: a missing or invalid argument is a -32602 error.

#### Scenario: Missing competitor
- **WHEN** `competitor_analysis` is requested without `competitor`
- **THEN** the server answers with an invalid-params error naming `competitor`

### Requirement: Prompts only name registered tools
Every tool name in a workflow's text, and in the built-in report template, SHALL exist in the registry.

#### Scenario: Tool renamed
- **WHEN** a tool a workflow mentions is renamed or removed
- **THEN** `workflow-prompts.test.ts` fails

### Requirement: Spending discipline in paid workflows
Every workflow that can reach DataForSEO SHALL instruct the agent to:
- read `project_context_get` research.recent_lookups before buying;
- call `dataforseo_balance`;
- run each paid tool with `estimate_only: true` first and stay within `max_cost_usd`;
- stop and ask above $2 for the workflow.

#### Scenario: Keyword research
- **WHEN** `keyword_research` is requested
- **THEN** its text contains the spending rules before the first paid step
