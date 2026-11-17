import { z } from 'zod'

/** Market inputs shared by DataForSEO tools: a location (code wins over name) and a language. */

export const marketShape = {
  location_code: z.number().int().positive().optional(),
  location_name: z.string().optional().default('United States'),
  language_code: z.string().min(2).optional().default('en'),
}

export const marketProperties = {
  location_code: { type: 'number', description: 'DataForSEO location code, e.g. 2840 (United States); wins over location_name. Look codes up with serp_locations.' },
  location_name: { type: 'string', description: 'DataForSEO location name (default "United States")', default: 'United States' },
  language_code: { type: 'string', description: 'Language code (default "en")', default: 'en' },
}

export function marketTask(m: { location_code?: number; location_name?: string; language_code?: string }): Record<string, unknown> {
  return {
    ...(m.location_code ? { location_code: m.location_code } : { location_name: m.location_name ?? 'United States' }),
    language_code: m.language_code ?? 'en',
  }
}
