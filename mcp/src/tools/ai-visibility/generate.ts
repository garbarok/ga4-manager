import type { ProjectContext } from '../../utils/project-context-store.js'
import type { TrackedPrompt } from './store.js'

/**
 * Deterministic prompt candidates from project context (no LLM call): the
 * questions a buyer would type into an AI assistant about the site's topics,
 * its brand and its competitors. The Operator or agent picks which to track.
 */

export interface GenerateInput {
  topics: string[]
  audience?: string
  brand?: string
  competitors: { domain: string; name?: string }[]
  max: number
}

export interface GeneratedPrompt extends TrackedPrompt {
  /** Which template produced it. */
  template: string
}

/** "example.com" → "Example"; a brand name stays as given. */
export function brandFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function contextInputs(ctx: ProjectContext | null, extraTopics: string[] = []): Omit<GenerateInput, 'max' | 'audience'> {
  const topics = [...extraTopics, ...(ctx?.key_pages ?? []).map((p) => p.topic ?? '').filter(Boolean)]
  return {
    topics: [...new Set(topics.map((t) => t.trim()).filter(Boolean))],
    brand: ctx?.brand_name ?? (ctx ? brandFromDomain(ctx.site) : undefined),
    competitors: ctx?.competitors ?? [],
  }
}

export function generatePrompts(input: GenerateInput): GeneratedPrompt[] {
  const out: GeneratedPrompt[] = []
  const add = (text: string, template: string, tags: string[]) => out.push({ text, template, tags })
  const audience = input.audience?.trim()

  for (const topic of input.topics) {
    add(`what are the best ${topic} tools`, 'best_topic_tools', ['category', topic])
    add(`what is the best ${topic}`, 'best_topic', ['category', topic])
    if (audience) add(`what is the best ${topic} for ${audience}`, 'best_topic_for_audience', ['category', 'audience', topic])
    add(`how do I choose a ${topic}`, 'how_to_choose', ['category', 'consideration', topic])
  }
  if (input.brand) {
    add(`${input.brand} reviews`, 'brand_reviews', ['brand'])
    add(`is ${input.brand} good`, 'brand_good', ['brand'])
    add(`what is ${input.brand}`, 'brand_what', ['brand'])
  }
  for (const c of input.competitors) {
    const name = c.name?.trim() || brandFromDomain(c.domain)
    if (input.brand) add(`${input.brand} vs ${name}`, 'brand_vs_competitor', ['comparison', c.domain])
    add(`alternatives to ${name}`, 'competitor_alternatives', ['alternatives', c.domain])
  }

  const seen = new Set<string>()
  return out
    .filter((p) => {
      const key = p.text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, input.max)
}
