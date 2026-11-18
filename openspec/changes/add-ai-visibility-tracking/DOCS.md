# Docs to merge (README tool table, CHANGELOG)

> Merged into README.md, mcp/README.md, CHANGELOG.md and mcp/CHANGELOG.md on 2026-11-18. Kept as the change's record.

## README.md tool table row

| Group | Tools |
|-------|-------|
| AI visibility | `ai_visibility_research`, `ai_visibility_prompts_generate`, `ai_visibility_tracker_save`, `ai_visibility_estimate`, `ai_visibility_explore`, `ai_visibility_run`, `ai_visibility_results`, `ai_visibility_trend`, `ai_visibility_sources`, `ai_visibility_answer`, `ai_visibility_export` |

## mcp/README.md section

### AI visibility (DataForSEO)

Track whether AI answer engines mention and cite your site, against your competitors, over time.

Workflow:
1. Fill project context (brand, competitors, key-page topics).
2. Draft prompts: `ai_visibility_prompts_generate` (free), or research real questions with `ai_visibility_research` (paid).
3. Save the prompt set: `ai_visibility_tracker_save`.
4. Check the cost: `ai_visibility_estimate` (free).
5. Run it: `ai_visibility_run`. Schedule weekly with cron: `ga4m ai-visibility-run --site example.com`.
6. Read the results: `ai_visibility_results`, `ai_visibility_trend`, `ai_visibility_sources`, `ai_visibility_answer`, `ai_visibility_export`.

| Engine id | What it queries | Approx. cost per prompt |
|-----------|-----------------|-------------------------|
| `chatgpt` | ChatGPT web UI with search (LLM Scraper) | $0.004 |
| `gemini` | Gemini web UI (LLM Scraper) | $0.004 |
| `google_ai_overview` | Google AI Overview (SERP, async AIO) | $0.004 |
| `google_ai_mode` | Google AI Mode | $0.004 |
| `claude` | Claude API, claude-haiku-5-5, web search | ~$0.012 |
| `perplexity` | Perplexity API, sonar | ~$0.006 |
| `chatgpt_api` | OpenAI API, gpt-5.4-mini, web search | ~$0.021 |
| `gemini_api` | Gemini API, gemini-3.5-flash, web search | ~$0.033 |

The default engines are `chatgpt`, `google_ai_overview` and `google_ai_mode`. Paid tools refuse above `max_cost_usd` or the balance. `estimate_only` shows the breakdown without spending. Answers are cached for 7 days per site.

## CHANGELOG.md / mcp/CHANGELOG.md (Unreleased → Added)

- **AI visibility tracking** (11 tools, each also a `ga4m` command):
  - prompt research from DataForSEO LLM Mentions;
  - deterministic prompt generation from project context;
  - a saved prompt set per site;
  - cost-gated runs across ChatGPT, Gemini, Google AI Overview / AI Mode, Claude, Perplexity and the OpenAI/Gemini APIs, storing every answer;
  - mention, rank-vs-competitor, citation and share-of-voice results, trend over runs, top cited sources, a single stored answer, and CSV/JSON export.
- Cost estimates now include measured surcharges the DataForSEO price list does not show: async AI Overview and AI Mode SERPs, and LLM tokens.
