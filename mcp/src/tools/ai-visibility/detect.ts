import { normalizeDomain } from '../../utils/dataforseo-client.js'
import type { AnswerRecord, ModelId } from './models.js'

/**
 * Pure detection over one stored answer: is the brand mentioned (and where),
 * is the site cited, and which competitors appear. No I/O.
 *
 *   mentioned   ≔ a brand term or the site domain occurs in the answer text
 *                 (case-insensitive, on word boundaries)
 *   cited       ≔ a source's domain is the site domain or a subdomain of it
 *   mention_rank ≔ 1 + the number of distinct tracked competitors named
 *                 before the brand's first mention (1 = named first)
 */

export interface Entity {
  domain: string
  name?: string
}

export interface BrandSpec {
  site: string
  terms: string[]
}

export interface CompetitorAppearance {
  domain: string
  name: string | null
  mentioned: boolean
  cited: boolean
}

export interface PromptModelResult {
  prompt: string
  model: ModelId
  available: boolean
  mentioned: boolean
  /** Character offset of the first brand mention; null when not mentioned. */
  first_mention_offset: number | null
  mention_rank: number | null
  cited: boolean
  cited_urls: string[]
  source_count: number
  competitors: CompetitorAppearance[]
  error?: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** First offset of any term as a whole word (letters/digits on neither side), or -1. */
export function firstOccurrence(text: string, terms: string[]): number {
  let best = -1
  for (const raw of terms) {
    const term = raw.trim()
    if (term.length < 2) continue
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu')
    const m = re.exec(text)
    if (m && (best === -1 || m.index < best)) best = m.index
  }
  return best
}

export function domainMatches(domain: string | null, target: string): boolean {
  if (!domain) return false
  const d = normalizeDomain(domain)
  const t = normalizeDomain(target)
  return d === t || d.endsWith(`.${t}`)
}

function entityTerms(e: Entity): string[] {
  return [e.domain, ...(e.name ? [e.name] : [])]
}

export function analyzeAnswer(answer: AnswerRecord, brand: BrandSpec, competitors: Entity[]): PromptModelResult {
  const text = answer.answer_text
  const brandTerms = [...new Set([brand.site, ...brand.terms])]
  const offset = firstOccurrence(text, brandTerms)
  const citedUrls = answer.sources.filter((s) => domainMatches(s.domain, brand.site)).map((s) => s.url)

  const comp = competitors.map((c) => {
    const at = firstOccurrence(text, entityTerms(c))
    return {
      appearance: {
        domain: normalizeDomain(c.domain),
        name: c.name ?? null,
        mentioned: at >= 0,
        cited: answer.sources.some((s) => domainMatches(s.domain, c.domain)),
      },
      at,
    }
  })

  const mentioned = offset >= 0
  return {
    prompt: answer.prompt,
    model: answer.model,
    available: answer.available,
    mentioned,
    first_mention_offset: mentioned ? offset : null,
    mention_rank: mentioned ? 1 + comp.filter((c) => c.at >= 0 && c.at < offset).length : null,
    cited: citedUrls.length > 0,
    cited_urls: citedUrls,
    source_count: answer.sources.length,
    competitors: comp.map((c) => c.appearance),
    ...(answer.error ? { error: answer.error } : {}),
  }
}

// ============================================================================
// Aggregates
// ============================================================================

export interface ModelSummary {
  model: ModelId
  answers: number
  /** Answers the engine actually produced (an AI Overview may not show). */
  answered: number
  mentioned: number
  cited: number
  /** mentioned / answered, 0–1, 3 decimals; null when nothing was answered. */
  mention_rate: number | null
  citation_rate: number | null
  avg_mention_rank: number | null
  /**
   * Share of voice among the brand and tracked competitors: each entity's
   * answer mentions divided by all entity mentions (0–1).
   */
  share_of_voice: { entity: string; is_brand: boolean; mentions: number; share: number }[]
}

function rate(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 1000
}

export function summarize(results: PromptModelResult[], brandSite: string, competitors: Entity[]): ModelSummary[] {
  const byModel = new Map<ModelId, PromptModelResult[]>()
  for (const r of results) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r])
  return [...byModel.entries()].map(([model, rows]) => {
    const answered = rows.filter((r) => r.available && !r.error)
    const mentioned = answered.filter((r) => r.mentioned)
    const ranks = mentioned.map((r) => r.mention_rank!).filter((n) => n !== null)
    const counts = [
      { entity: normalizeDomain(brandSite), is_brand: true, mentions: mentioned.length },
      ...competitors.map((c) => ({
        entity: normalizeDomain(c.domain),
        is_brand: false,
        mentions: answered.filter((r) => r.competitors.some((x) => x.domain === normalizeDomain(c.domain) && x.mentioned)).length,
      })),
    ]
    const total = counts.reduce((a, c) => a + c.mentions, 0)
    return {
      model,
      answers: rows.length,
      answered: answered.length,
      mentioned: mentioned.length,
      cited: answered.filter((r) => r.cited).length,
      mention_rate: rate(mentioned.length, answered.length),
      citation_rate: rate(answered.filter((r) => r.cited).length, answered.length),
      avg_mention_rank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 100) / 100 : null,
      share_of_voice: counts.map((c) => ({ ...c, share: total === 0 ? 0 : Math.round((c.mentions / total) * 1000) / 1000 })),
    }
  })
}
