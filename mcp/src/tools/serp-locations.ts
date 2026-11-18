import { z } from 'zod'
import { native } from '../tool-spec.js'
import { dataforseoRequest } from '../utils/dataforseo-client.js'
import { ToolError, ErrorCode } from '../utils/errors.js'
import { guard } from '../utils/site-input.js'

/**
 * Location and language code lookup (OpenSEO search_serp_locations), from
 * DataForSEO's free endpoints:
 *   - dataforseo_labs/locations_and_languages: countries with their languages
 *     (what Labs tools accept);
 *   - serp/google/locations/{country}: regions and cities of one country (what
 *     SERP tools, e.g. rank trackers, also accept).
 * Lists are cached in memory for the server's lifetime; they change rarely.
 */

export const LABS_LOCATIONS_PATH = 'dataforseo_labs/locations_and_languages'

interface LabsLocation {
  location_code: number
  location_name: string
  country_iso_code?: string | null
  location_type?: string | null
  available_languages?: { language_name: string; language_code: string }[] | null
}

interface SerpLocation {
  location_code: number
  location_name: string
  location_code_parent?: number | null
  country_iso_code?: string | null
  location_type?: string | null
}

const memo = new Map<string, Promise<unknown[]>>()

/** Reset the in-memory lists. For tests. */
export function resetLocationCache(): void {
  memo.clear()
}

async function freeList<T>(path: string): Promise<T[]> {
  if (!memo.has(path)) {
    const p = dataforseoRequest<T>({ method: 'GET', path, unbilled: true }).then((r) => r.items as unknown[])
    p.catch(() => memo.delete(path))
    memo.set(path, p)
  }
  return (await memo.get(path)) as T[]
}

export const serpLocationsSchema = z.object({
  query: z.string().optional(),
  country_iso_code: z.string().length(2).optional(),
  include_regions: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(500).optional().default(25),
})

export type SerpLocationsInput = z.infer<typeof serpLocationsSchema>

export function matchQuery(name: string, query: string | undefined): boolean {
  if (!query?.trim()) return true
  const hay = name.toLowerCase()
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((part) => hay.includes(part))
}

export async function runSerpLocations(input: SerpLocationsInput) {
  return guard(async () => {
    const cc = input.country_iso_code?.toUpperCase()
    if (input.include_regions && !cc) {
      throw new ToolError(ErrorCode.INVALID_INPUT, 'include_regions needs country_iso_code (e.g. "ES"): region lists are per country.')
    }
    const countries = await freeList<LabsLocation>(LABS_LOCATIONS_PATH)
    const countryRows = countries
      .filter((c) => (!cc || c.country_iso_code === cc) && (input.include_regions ? true : matchQuery(c.location_name, input.query)))
      .map((c) => ({
        location_code: c.location_code,
        location_name: c.location_name,
        country_iso_code: c.country_iso_code ?? null,
        location_type: c.location_type ?? 'Country',
        languages: (c.available_languages ?? []).map((l) => ({ language_code: l.language_code, language_name: l.language_name })),
      }))

    let regions: SerpLocation[] | null = null
    if (input.include_regions && cc) {
      const list = await freeList<SerpLocation>(`serp/google/locations/${cc.toLowerCase()}`)
      regions = list.filter((l) => l.location_type !== 'Country' && matchQuery(l.location_name, input.query)).slice(0, input.limit)
    }

    return {
      success: true as const,
      countries: countryRows.slice(0, input.limit),
      regions: regions?.map((r) => ({
        location_code: r.location_code,
        location_name: r.location_name,
        location_type: r.location_type ?? null,
        parent_code: r.location_code_parent ?? null,
      })) ?? null,
      note: 'Labs tools (domain_overview, serp_competitors, keyword_suggestions) accept country codes; SERP tools (rank trackers) also accept region and city codes.',
      cost_usd: 0,
    }
  })
}

export const serpLocationsSpec = native({
  tool: {
    name: 'serp_locations',
    description:
      'Use to look up DataForSEO location_code and language_code values before a paid call (OpenSEO search_serp_locations). Free. ' +
      'Filter countries by name (query: "spain"); country_iso_code + include_regions: true lists regions and cities of one country (query: "madrid"). ' +
      'Each country lists its supported languages with language_code.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name filter, e.g. "united kingdom" or "madrid" (all words must match)' },
        country_iso_code: { type: 'string', description: 'Two-letter country code, e.g. "ES"' },
        include_regions: { type: 'boolean', description: 'List regions and cities of country_iso_code (default false)', default: false },
        limit: { type: 'number', description: 'Max rows per list (default 25)', default: 25 },
      },
    },
    annotations: { title: 'Location and language codes', readOnlyHint: true, openWorldHint: true },
  },
  schema: serpLocationsSchema,
  run: async (input) => {
    const output = await runSerpLocations(input)
    return { output, isError: !output.success }
  },
})
