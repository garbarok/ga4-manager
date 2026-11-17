import { dataforseoRequest, sumCosts } from '../../utils/dataforseo-client.js'
import type { PlannedRequest } from '../../utils/paid-gate.js'
import { MODELS, type AnswerRecord, type ModelId, type QueryOptions } from './models.js'

/** Requests in flight at once; scraper calls can take a minute or more. */
export const CONCURRENCY = 5
const TIMEOUT_MS = 180_000

export interface Cell {
  prompt: string
  model: ModelId
}

export function cells(prompts: string[], models: ModelId[]): Cell[] {
  return prompts.flatMap((prompt) => models.map((model) => ({ prompt, model })))
}

/** The exact requests a run would make, for the cost gate (and its cache check). */
export function planFor(list: Cell[], opts: QueryOptions): PlannedRequest[] {
  return list.map(({ prompt, model }) => {
    const def = MODELS[model]
    return { path: def.path, task: def.buildTask(prompt, opts), surcharge_usd: def.surcharge_usd }
  })
}

/** Ask one engine one prompt. Failures become an AnswerRecord with `error`, never a throw. */
export async function fetchAnswer(cell: Cell, opts: QueryOptions, now: () => Date = () => new Date()): Promise<AnswerRecord> {
  const def = MODELS[cell.model]
  try {
    const { items, cost } = await dataforseoRequest<unknown>({ path: def.path, task: def.buildTask(cell.prompt, opts), timeoutMs: TIMEOUT_MS })
    const normalized = def.normalize(items[0], cell.prompt)
    return { model: cell.model, ...normalized, fetched_at: now().toISOString(), cost_usd: cost }
  } catch (err) {
    const cost = (err as { cost?: number | null }).cost ?? null
    return {
      model: cell.model,
      model_version: null,
      prompt: cell.prompt,
      available: false,
      answer_text: '',
      sources: [],
      fetched_at: now().toISOString(),
      cost_usd: cost,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function fetchAll(list: Cell[], opts: QueryOptions): Promise<{ answers: AnswerRecord[]; cost_usd: number | null }> {
  const answers: AnswerRecord[] = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const i = next++
      answers[i] = await fetchAnswer(list[i], opts)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker))
  return { answers, cost_usd: sumCosts(answers.map((a) => a.cost_usd)) }
}
