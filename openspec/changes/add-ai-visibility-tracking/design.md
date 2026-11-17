# Design

## Context

- `llm_mentions` already calls `ai_optimization/llm_mentions/search/live` with `target: [{keyword}]`.
- ADR-0006 provides the cost gate, the per-site lookup cache (7-day TTL for `ai_optimization/*` and `serp/google/ai_mode/*`), the research log and collection storage.
- DataForSEO exposes AI answers through three API families, each with its own response shape. All shapes were captured live on 2026-11-17 with one generic prompt (total spend about $0.09):

| Engine id | Endpoint | Answer | Citations |
|-----------|----------|--------|-----------|
| `chatgpt` | `ai_optimization/chat_gpt/llm_scraper/live/advanced` | `result.markdown` | `result.sources[]` |
| `gemini` | `ai_optimization/gemini/llm_scraper/live/advanced` | `result.markdown` | `result.sources[]` |
| `google_ai_mode` | `serp/google/ai_mode/live/advanced` | `items[type=ai_overview].markdown` | `references[]`, element `links[]` |
| `google_ai_overview` | `serp/google/organic/live/advanced` + `load_async_ai_overview`, depth 10 | same | same |
| `claude`, `perplexity`, `chatgpt_api`, `gemini_api` | `ai_optimization/{provider}/llm_responses/live`, `web_search: true` | `items[type=message].sections[].text` | `sections[].annotations[]`, else `search_results[]` |

## Decisions

### D1. One AnswerRecord, one normalizer per family
Each engine is a `ModelDef`: path, `buildTask`, `normalize` and `surcharge_usd`. The normalizers produce `{model, model_version, prompt, available, answer_text, sources[{url, domain, title?}], fetched_at, cost_usd, error?}`.
- URLs lose tracking parameters (`utm_*`, `gclid`, …), so ChatGPT's `?utm_source=chatgpt.com` does not split one source into two.
- AI Overview references sometimes point to `google.com/goto?url=…`. The real site is then only in `source`. A domain-like `source` becomes the domain; a name ("Webmaster Tips") gives `domain: null` and a title.
- A SERP without an AI Overview yields `available: false`. It is not an error, and it is excluded from rates.

### D2. Detection is a pure function
- `mentioned`: a brand term or the site domain occurs in the answer on Unicode word boundaries.
- `cited`: a source domain equals the site or is a subdomain of it.
- `mention_rank`: 1 + the number of tracked competitors named before the brand. This answers "where in the list are we".
- Rates are computed over answered cells only, so failures and missing AI Overviews do not dilute them.
- Share of voice is each entity's answer mentions divided by all entity mentions, per engine.

### D3. Default API models are cheap and pinned
`claude-haiku-5-5`, `sonar`, `gpt-5.4-mini` and `gemini-3.5-flash`, taken from the free `llm_responses/models` lists. The model name is part of the cache key. Changing a default therefore invalidates the cache instead of mixing answers from different models.

### D4. Surcharges cover what the price list hides
Measured live:
- AI Overview (async) and AI Mode bill $0.004, not the listed $0.002.
- LLM Responses bill tokens: Claude Haiku $0.012, gpt-5.4-mini $0.021, Gemini Flash $0.033, Sonar $0.006, against $0.0006 listed plus the gate's $0.01 allowance.

`PlannedRequest.surcharge_usd` carries the difference, so estimates match real bills to within a cent.

### D5. Storage
- The tracker is a record per site and id (`default` unless named).
- A run stores the summary, per-cell results and the full answers, so `ai_visibility_answer` and later re-analysis need no new spend.
- Runs use `newId()` ids, which sort by time. Results, sources and export default to the newest run.
- Trend reads up to 26 runs (half a year weekly). It returns oldest to newest, with the change from first to last.

### D6. Research uses the llm_mentions task shape
`ai_visibility_research` sends the exact task `llm_mentions` sends. The two tools therefore share cache entries and research-log semantics. Questions are deduped case-insensitively and sorted by AI search volume.

## Non-goals

- No LLM-generated prompts. `ai_visibility_prompts_generate` is deterministic, and the agent can edit its output.
- No scheduling. Weekly runs are a cron line: `ga4m ai-visibility-run --site example.com`.
- No sentiment scoring of answers.
