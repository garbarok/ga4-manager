# Spec Delta

## ADDED Requirements

### Requirement: Every paid AI-visibility call is estimated and gated
`ai_visibility_research`, `ai_visibility_explore` and `ai_visibility_run` SHALL build the exact request plan, price it from DataForSEO's live price list (plus measured surcharges), and read the balance before spending. They SHALL refuse with `INVALID_INPUT` when the estimate exceeds `max_cost_usd`, and with `QUOTA_EXCEEDED` when it exceeds the balance. With `estimate_only` they SHALL return the estimate and spend nothing. Requests the lookup cache would answer SHALL count as $0. `ai_visibility_estimate` SHALL price a tracker run without spending.

#### Scenario: Run above the cap
- **WHEN** `ai_visibility_run` is called and the estimate exceeds `max_cost_usd`
- **THEN** it returns `INVALID_INPUT`, and no billed endpoint is called

#### Scenario: Repeat inside the cache TTL
- **WHEN** the same run is repeated within 7 days through the dispatcher
- **THEN** its estimate is $0, `cost_usd` is 0, and the output's `cache.hits` equals the request count

### Requirement: Answers are normalized across engines
Each engine's response SHALL be normalized into an AnswerRecord with the answer text and cited sources:
- source URLs without tracking parameters;
- domains lowercase without `www`;
- a Google redirect reference resolved to the named site, or `domain: null`.

A SERP without an AI Overview SHALL yield `available: false`, not an error.

#### Scenario: AI Overview absent
- **WHEN** Google shows no AI Overview for a tracked prompt
- **THEN** the cell is `available: false` and is excluded from mention and citation rates

### Requirement: Mention, rank, citation and competitor detection
For each prompt × engine, the tool SHALL report:
- `mentioned`: a brand term or the site domain appears in the answer as a whole word, case-insensitive;
- `first_mention_offset`;
- `mention_rank`: 1 + tracked competitors named earlier;
- `cited` and `cited_urls`: sources on the site domain or its subdomains;
- per competitor, `mentioned` and `cited`.

#### Scenario: Brand named third
- **WHEN** an answer names two tracked competitors before the brand
- **THEN** `mention_rank` is 3

### Requirement: Saved prompt sets and stored runs
`ai_visibility_tracker_save` SHALL store per site and tracker id:
- prompts with tags;
- engines;
- brand terms (default: the project context brand name);
- competitors (default: project context competitors);
- location and language.

`prompts` SHALL replace the set, and `add_prompts` / `remove_prompts` SHALL patch it. `ai_visibility_run` SHALL store a dated run with every answer, per-cell results and per-engine summary (`mention_rate`, `citation_rate`, `avg_mention_rank`, `share_of_voice`). Failed cells SHALL be kept in the run with their error.

#### Scenario: One engine fails
- **WHEN** one engine returns HTTP 500 during a run
- **THEN** the run is stored, its cells carry `error`, and the output lists them under `failed`

### Requirement: Reads over stored runs are free
- `ai_visibility_results` SHALL return the newest run by default, filterable by engine and by mentioned / not_mentioned / cited / errors.
- `ai_visibility_trend` SHALL return per-engine points from oldest to newest, with the change from first to last.
- `ai_visibility_sources` SHALL rank cited domains or URLs across the latest run or all runs, flagging the site and tracked competitors.
- `ai_visibility_answer` SHALL return one stored answer by prompt text or 1-based index.
- `ai_visibility_export` SHALL return CSV or JSON, and write it under `<state_dir>/exports/<site>/` when `write` is true.

#### Scenario: Trend after two runs
- **WHEN** the brand was mentioned in 1 of 2 answers in the first run and 2 of 2 in the second
- **THEN** the trend shows mention_rate 0.5 then 1, with change +0.5

### Requirement: Prompt research and generation
- `ai_visibility_research` SHALL return the questions found per seed keyword, deduped and ordered by AI search volume, with whether the site is cited; the top cited domains; and up to 30 suggested prompts.
- `ai_visibility_prompts_generate` SHALL return deterministic templates from project context topics, brand, competitors and the optional audience, deduped and capped at `max`. It SHALL warn when the site has no project context.

#### Scenario: No project context
- **WHEN** prompts are generated for a site without project context
- **THEN** only the passed topics are used, and a warning says to fill project context
