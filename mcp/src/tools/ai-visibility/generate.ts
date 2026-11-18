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
  /** Prompt language (en, es, de, fr). Other codes fall back to English. */
  language?: string
}

interface Templates {
  best_topic_tools: (t: string) => string
  best_topic: (t: string) => string
  best_topic_for_audience: (t: string, a: string) => string
  how_to_choose: (t: string) => string
  brand_reviews: (b: string) => string
  brand_good: (b: string) => string
  brand_what: (b: string) => string
  brand_vs_competitor: (b: string, c: string) => string
  competitor_alternatives: (c: string) => string
}

/**
 * One template set per language, written as a native speaker would type the
 * question; topics are noun phrases ("cuidado del jardín"), so templates wrap
 * them with a preposition instead of using them as adjectives.
 */
export const TEMPLATES: Record<string, Templates> = {
  en: {
    best_topic_tools: (t) => `what are the best ${t} tools`,
    best_topic: (t) => `what is the best ${t}`,
    best_topic_for_audience: (t, a) => `what is the best ${t} for ${a}`,
    how_to_choose: (t) => `how do I choose a ${t}`,
    brand_reviews: (b) => `${b} reviews`,
    brand_good: (b) => `is ${b} good`,
    brand_what: (b) => `what is ${b}`,
    brand_vs_competitor: (b, c) => `${b} vs ${c}`,
    competitor_alternatives: (c) => `alternatives to ${c}`,
  },
  es: {
    best_topic_tools: (t) => `¿cuáles son las mejores apps para ${t}?`,
    best_topic: (t) => `¿cuál es la mejor app de ${t}?`,
    best_topic_for_audience: (t, a) => `¿cuál es la mejor app de ${t} para ${a}?`,
    how_to_choose: (t) => `¿cómo elegir una app de ${t}?`,
    brand_reviews: (b) => `opiniones de ${b}`,
    brand_good: (b) => `¿${b} es buena?`,
    brand_what: (b) => `¿qué es ${b}?`,
    brand_vs_competitor: (b, c) => `${b} vs ${c}`,
    competitor_alternatives: (c) => `alternativas a ${c}`,
  },
  de: {
    best_topic_tools: (t) => `Was sind die besten Apps für ${t}?`,
    best_topic: (t) => `Was ist die beste App für ${t}?`,
    best_topic_for_audience: (t, a) => `Was ist die beste App für ${t} für ${a}?`,
    how_to_choose: (t) => `Wie wähle ich eine App für ${t}?`,
    brand_reviews: (b) => `${b} Erfahrungen`,
    brand_good: (b) => `Ist ${b} gut?`,
    brand_what: (b) => `Was ist ${b}?`,
    brand_vs_competitor: (b, c) => `${b} vs ${c}`,
    competitor_alternatives: (c) => `Alternativen zu ${c}`,
  },
  fr: {
    best_topic_tools: (t) => `quelles sont les meilleures applications pour ${t} ?`,
    best_topic: (t) => `quelle est la meilleure application de ${t} ?`,
    best_topic_for_audience: (t, a) => `quelle est la meilleure application de ${t} pour ${a} ?`,
    how_to_choose: (t) => `comment choisir une application de ${t} ?`,
    brand_reviews: (b) => `avis ${b}`,
    brand_good: (b) => `${b} est-il bien ?`,
    brand_what: (b) => `qu'est-ce que ${b} ?`,
    brand_vs_competitor: (b, c) => `${b} vs ${c}`,
    competitor_alternatives: (c) => `alternatives à ${c}`,
  },
}

/** The template language for a code ("es-ES" → "es"); null when unsupported. */
export function templateLanguage(code: string | undefined): string | null {
  const base = (code ?? 'en').toLowerCase().split(/[-_]/)[0]
  return TEMPLATES[base] ? base : null
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
  const T = TEMPLATES[templateLanguage(input.language) ?? 'en']

  for (const topic of input.topics) {
    add(T.best_topic_tools(topic), 'best_topic_tools', ['category', topic])
    add(T.best_topic(topic), 'best_topic', ['category', topic])
    if (audience) add(T.best_topic_for_audience(topic, audience), 'best_topic_for_audience', ['category', 'audience', topic])
    add(T.how_to_choose(topic), 'how_to_choose', ['category', 'consideration', topic])
  }
  if (input.brand) {
    add(T.brand_reviews(input.brand), 'brand_reviews', ['brand'])
    add(T.brand_good(input.brand), 'brand_good', ['brand'])
    add(T.brand_what(input.brand), 'brand_what', ['brand'])
  }
  for (const c of input.competitors) {
    const name = c.name?.trim() || brandFromDomain(c.domain)
    if (input.brand) add(T.brand_vs_competitor(input.brand, name), 'brand_vs_competitor', ['comparison', c.domain])
    add(T.competitor_alternatives(name), 'competitor_alternatives', ['alternatives', c.domain])
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
