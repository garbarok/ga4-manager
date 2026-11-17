import { normalizeDomain } from '../../utils/dataforseo-client.js'

/**
 * The AI answer engines AI-visibility tracking can query through DataForSEO,
 * and one normalizer per response shape into a common AnswerRecord.
 *
 * Shapes were captured live (2026-11-17) and are pinned by the fixtures in
 * ../__fixtures__/ai-visibility/:
 *   - llm_scraper (ChatGPT, Gemini web UIs): result.markdown + result.sources[]
 *   - SERP (AI Mode, AI Overview): an `ai_overview` item with markdown + references[]
 *   - llm_responses (model APIs with web search): items[type=message].sections[].text
 *     + sections[].annotations[] (citations), falling back to search_results[]
 */

export const MODEL_IDS = [
  'chatgpt',
  'gemini',
  'google_ai_mode',
  'google_ai_overview',
  'claude',
  'perplexity',
  'chatgpt_api',
  'gemini_api',
] as const

export type ModelId = (typeof MODEL_IDS)[number]

export const DEFAULT_MODELS: ModelId[] = ['chatgpt', 'google_ai_overview', 'google_ai_mode']

export interface AnswerSource {
  url: string
  /** Lowercase host without www; null when the engine only gave a name (some AI Overview references). */
  domain: string | null
  title?: string
}

export interface AnswerRecord {
  model: ModelId
  /** What the engine reported it ran (e.g. "gpt-6", "claude-haiku-5-5"); null when not reported. */
  model_version: string | null
  prompt: string
  /** False when the engine returned no answer (e.g. Google showed no AI Overview). */
  available: boolean
  answer_text: string
  sources: AnswerSource[]
  fetched_at: string
  cost_usd: number | null
  error?: string
}

export interface QueryOptions {
  location_code: number
  language_code: string
}

export interface ModelDef {
  id: ModelId
  label: string
  path: string
  buildTask: (prompt: string, opts: QueryOptions) => Record<string, unknown>
  normalize: (result: unknown, prompt: string) => Omit<AnswerRecord, 'model' | 'fetched_at' | 'cost_usd'>
  /**
   * Measured cost on top of DataForSEO's list price (USD per request): async
   * AI Overview loading, AI Mode, and LLM tokens beyond the gate's allowance.
   * Measured live on 2026-11-17 with a one-sentence prompt.
   */
  surcharge_usd: number
}

/** Cheap default API models, from the free `llm_responses/models` lists (2026-11-17). */
export const DEFAULT_API_MODEL: Record<'claude' | 'perplexity' | 'chatgpt_api' | 'gemini_api', string> = {
  claude: 'claude-haiku-5-5',
  perplexity: 'sonar',
  chatgpt_api: 'gpt-5.4-mini',
  gemini_api: 'gemini-3.5-flash',
}

// ============================================================================
// Shared helpers
// ============================================================================

type Obj = Record<string, unknown>

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|srsltid)$/i

/** Drop tracking parameters (ChatGPT appends utm_source=chatgpt.com) so URLs compare equal. */
export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw)
    for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
    return u.toString()
  } catch {
    return raw
  }
}

export function hostOf(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname)
  } catch {
    return null
  }
}

const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i

function source(urlRaw: unknown, domainRaw: unknown, titleRaw: unknown, nameRaw?: unknown): AnswerSource | null {
  const url = str(urlRaw)
  if (!url) return null
  let domain = str(domainRaw) ? normalizeDomain(domainRaw as string) : hostOf(url)
  // AI Overview references sometimes point at google.com/goto?url=… redirects;
  // the real site is then only in `source` (a domain or a site name).
  if (domain === 'google.com' && /\/goto\?/.test(url)) {
    const name = str(nameRaw)
    domain = name && DOMAIN_LIKE.test(name.trim()) ? normalizeDomain(name) : null
  }
  const title = str(titleRaw) ?? (str(nameRaw) && !DOMAIN_LIKE.test(String(nameRaw)) ? String(nameRaw) : null)
  return { url: cleanUrl(url), domain, ...(title ? { title } : {}) }
}

function dedupe(sources: (AnswerSource | null)[]): AnswerSource[] {
  const seen = new Set<string>()
  const out: AnswerSource[] = []
  for (const s of sources) {
    if (!s || seen.has(s.url)) continue
    seen.add(s.url)
    out.push(s)
  }
  return out
}

// ============================================================================
// Normalizers
// ============================================================================

/** ChatGPT / Gemini web-UI scraper: `markdown` is the answer, `sources` the cited links. */
export function normalizeScraper(result: unknown): Omit<AnswerRecord, 'model' | 'prompt' | 'fetched_at' | 'cost_usd'> {
  const r = obj(result)
  const text = str(r.markdown) ?? arr(r.items).map((i) => str(obj(i).markdown) ?? '').filter(Boolean).join('\n\n')
  const sources = dedupe(arr(r.sources).map((s) => source(obj(s).url, obj(s).domain, obj(s).title, obj(s).source_name)))
  return { model_version: str(r.model), available: Boolean(text), answer_text: text, sources }
}

/** Google AI Mode / AI Overview: the `ai_overview` SERP item, its markdown and references. */
export function normalizeAiOverview(result: unknown): Omit<AnswerRecord, 'model' | 'prompt' | 'fetched_at' | 'cost_usd'> {
  const r = obj(result)
  const item = arr(r.items).map(obj).find((i) => i.type === 'ai_overview')
  if (!item) return { model_version: null, available: false, answer_text: '', sources: [] }
  const elements = arr(item.items).map(obj)
  const text = str(item.markdown) ?? elements.map((e) => str(e.markdown) ?? str(e.text) ?? '').filter(Boolean).join('\n\n')
  const refs = [...arr(item.references), ...elements.flatMap((e) => arr(e.references))].map(obj)
  const links = elements.flatMap((e) => arr(e.links)).map(obj)
  const sources = dedupe([
    ...refs.map((s) => source(s.url, s.domain, s.title, s.source)),
    ...links.map((s) => source(s.url, s.domain, s.title)),
  ])
  return { model_version: null, available: Boolean(text), answer_text: text, sources }
}

/** Model APIs (llm_responses): message sections joined; annotations are the citations. */
export function normalizeLlmResponse(result: unknown): Omit<AnswerRecord, 'model' | 'prompt' | 'fetched_at' | 'cost_usd'> {
  const r = obj(result)
  const sections = arr(r.items)
    .map(obj)
    .filter((i) => i.type === 'message')
    .flatMap((i) => arr(i.sections).map(obj))
  const text = sections.map((s) => str(s.text) ?? '').filter(Boolean).join('\n\n')
  const annotations = sections.flatMap((s) => arr(s.annotations)).map(obj)
  const cited = dedupe(annotations.map((a) => source(a.url, null, a.title)))
  const sources = cited.length > 0 ? cited : dedupe(arr(r.search_results).map(obj).map((s) => source(s.url, null, s.title)))
  return { model_version: str(r.model_name), available: Boolean(text), answer_text: text, sources }
}

// ============================================================================
// Model table
// ============================================================================

function serpTask(prompt: string, o: QueryOptions): Record<string, unknown> {
  return { keyword: prompt, location_code: o.location_code, language_code: o.language_code }
}

function llmTask(model: string) {
  return (prompt: string): Record<string, unknown> => ({ user_prompt: prompt, model_name: model, web_search: true })
}

const withPrompt =
  (fn: (r: unknown) => Omit<AnswerRecord, 'model' | 'prompt' | 'fetched_at' | 'cost_usd'>) =>
  (r: unknown, prompt: string) => ({ ...fn(r), prompt })

export const MODELS: Record<ModelId, ModelDef> = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT (web UI with search)',
    path: 'ai_optimization/chat_gpt/llm_scraper/live/advanced',
    buildTask: serpTask,
    normalize: withPrompt(normalizeScraper),
    surcharge_usd: 0,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (web UI)',
    path: 'ai_optimization/gemini/llm_scraper/live/advanced',
    buildTask: serpTask,
    normalize: withPrompt(normalizeScraper),
    surcharge_usd: 0,
  },
  google_ai_mode: {
    id: 'google_ai_mode',
    label: 'Google AI Mode',
    path: 'serp/google/ai_mode/live/advanced',
    buildTask: serpTask,
    normalize: withPrompt(normalizeAiOverview),
    surcharge_usd: 0.002,
  },
  google_ai_overview: {
    id: 'google_ai_overview',
    label: 'Google AI Overview',
    path: 'serp/google/organic/live/advanced',
    buildTask: (prompt, o) => ({ ...serpTask(prompt, o), depth: 10, load_async_ai_overview: true }),
    normalize: withPrompt(normalizeAiOverview),
    surcharge_usd: 0.002,
  },
  claude: {
    id: 'claude',
    label: `Claude API (${DEFAULT_API_MODEL.claude}, web search)`,
    path: 'ai_optimization/claude/llm_responses/live',
    buildTask: llmTask(DEFAULT_API_MODEL.claude),
    normalize: withPrompt(normalizeLlmResponse),
    surcharge_usd: 0.005,
  },
  perplexity: {
    id: 'perplexity',
    label: `Perplexity API (${DEFAULT_API_MODEL.perplexity})`,
    path: 'ai_optimization/perplexity/llm_responses/live',
    buildTask: llmTask(DEFAULT_API_MODEL.perplexity),
    normalize: withPrompt(normalizeLlmResponse),
    surcharge_usd: 0,
  },
  chatgpt_api: {
    id: 'chatgpt_api',
    label: `OpenAI API (${DEFAULT_API_MODEL.chatgpt_api}, web search)`,
    path: 'ai_optimization/chat_gpt/llm_responses/live',
    buildTask: llmTask(DEFAULT_API_MODEL.chatgpt_api),
    normalize: withPrompt(normalizeLlmResponse),
    surcharge_usd: 0.015,
  },
  gemini_api: {
    id: 'gemini_api',
    label: `Gemini API (${DEFAULT_API_MODEL.gemini_api}, web search)`,
    path: 'ai_optimization/gemini/llm_responses/live',
    buildTask: llmTask(DEFAULT_API_MODEL.gemini_api),
    normalize: withPrompt(normalizeLlmResponse),
    surcharge_usd: 0.025,
  },
}
