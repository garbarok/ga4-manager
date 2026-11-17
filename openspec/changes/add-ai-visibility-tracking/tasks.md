# Tasks

## 1. Response shapes
- [x] 1.1 Capture live responses for ChatGPT and Gemini (LLM Scraper), AI Mode, AI Overview, and Claude, Perplexity, OpenAI and Gemini (LLM Responses) with one generic prompt (spend ≈ $0.09).
- [x] 1.2 Store redacted fixtures (real keys, synthetic tools on example domains) in `__fixtures__/ai-visibility/`, including a SERP without an AI Overview.

## 2. Core modules
- [x] 2.1 `ai-visibility/models.ts`: the engine table, three normalizers, URL cleaning and Google redirect resolution. Verify with `models.test.ts` on every fixture.
- [x] 2.2 `ai-visibility/detect.ts`: word-boundary mention, rank against competitors, citation and summary (rates, share of voice). Verify with `detect.test.ts`.
- [x] 2.3 `ai-visibility/store.ts`, `generate.ts` and `engine.ts`: tracker and run storage, trend, sources, CSV export, prompt templates, request plan, and a concurrency-5 fetch that records failures as cells.
- [x] 2.4 Add `PlannedRequest.surcharge_usd` to `paid-gate.ts` and set measured surcharges per engine.

## 3. Tools
- [x] 3.1 Paid: research, explore, estimate and run, all gated. Verify with `ai-visibility-paid.test.ts`: estimate math, cap and balance refusals with no paid call, partial failure, tag filter, and the cached repeat through the dispatcher at $0.
- [x] 3.2 Local: prompts_generate, tracker_save, results, trend, sources, answer and export. Verify with `ai-visibility-local.test.ts`.
- [x] 3.3 Register in `registry.ts`, run `manifest:sync`, and confirm every tool is in its reserved group (`server-info.test.ts`).

## 4. Checks
- [x] 4.1 `tsc --noEmit`, `eslint src/` and `vitest run` are green in `mcp/`.
- [ ] 4.2 README tool table and CHANGELOG entries, taken from `DOCS.md` when the parent branch merges this change.
