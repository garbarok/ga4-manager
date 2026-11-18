# Proposal

## Why

`llm_mentions` answers one question once: does DataForSEO's database of AI answers mention a domain for a few keywords? OpenSEO turns AI visibility into a tracked metric. It researches the prompts people ask, saves a prompt set per project, runs it across ChatGPT, Google AI Overviews / AI Mode and other engines, stores every answer, and reports mentions, citations, competitor share and the sources AI engines cite, over time. Without that, an agent cannot tell whether GEO work is moving anything, and it pays again for answers it already bought.

## What Changes

Eleven new tools. Each is an MCP tool and a `ga4m` command (ADR-0006).

**Paid (DataForSEO).** Every paid tool is cost-gated: it builds the exact request plan, prices it from the live price list, and checks it against `max_cost_usd` and the balance. `estimate_only` returns the estimate without spending. Answers are cached for 7 days.
- `ai_visibility_research`: prompt research for a market. Runs LLM Mentions search per seed keyword. Returns real questions with AI search volume, whether the site is cited, the top cited domains, and suggested prompts.
- `ai_visibility_explore`: one prompt across chosen engines now. Returns each answer, brand mention, rank against competitors, citations and competitor appearances. Nothing is stored except the cache.
- `ai_visibility_estimate`: free estimate of a tracker run (prompts × engines).
- `ai_visibility_run`: runs the saved prompt set across its engines and stores a dated run with every answer and its analysis.

**Free (local state).**
- `ai_visibility_prompts_generate`: deterministic prompt templates from project context (topics, brand, competitors, audience).
- `ai_visibility_tracker_save`: the saved prompt set per site: prompts with tags, engines, brand terms, competitors, location and language. Defaults come from project context.
- `ai_visibility_results`, `ai_visibility_trend`, `ai_visibility_sources`, `ai_visibility_answer`, `ai_visibility_export` (CSV or JSON): reads over stored runs.

**Engines:**
- `chatgpt` and `gemini`: the web UIs, via LLM Scraper.
- `google_ai_mode` and `google_ai_overview`: via SERP.
- `claude`, `perplexity`, `chatgpt_api` and `gemini_api`: model APIs with web search, via LLM Responses.

## Capabilities

### New Capabilities
- `ai-visibility`: AI-answer visibility tracking per site.

## Impact

- New: `mcp/src/tools/ai-visibility/{models,detect,engine,generate,store}.ts`, `mcp/src/tools/ai-visibility-paid.ts`, `mcp/src/tools/ai-visibility-local.ts`, tests, and fixtures in `mcp/src/tools/__fixtures__/ai-visibility/`.
- Changed: `mcp/src/utils/paid-gate.ts` gains an optional `surcharge_usd` per planned request. This is the cost DataForSEO bills but its price list does not show: async AI Overview loading, AI Mode and LLM tokens. The surcharges were measured live.
- Registry and manifest: 11 tools.
- State (ADR-0006 collections): `ai-visibility-trackers/<site>/<id>.json`, `ai-visibility-runs/<site>/<run_id>.json`, and `exports/<site>/` for written exports.
- No new scopes or dependencies. Paid tools need `DATAFORSEO_USERNAME` / `DATAFORSEO_PASSWORD`. `ai_visibility_research` also needs the LLM Mentions subscription.
