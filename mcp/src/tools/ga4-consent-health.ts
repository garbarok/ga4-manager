import { z } from 'zod'
import { getGoogleAuthHeaders } from '../utils/google-auth.js'

// ============================================================================
// Input Schema
// ============================================================================

export const ga4ConsentHealthInputSchema = z.object({
  /** GA4 property ID in format "properties/123456789" */
  property_id: z
    .string()
    .min(1, 'property_id is required')
    .regex(/^properties\/\d+$/, 'property_id must be in format "properties/123456789"'),
  /** Number of days to analyze (default: 28) */
  days: z.number().int().min(1).max(365).optional().default(28),
  /** Optional custom consent-granted event name */
  custom_grant_event: z.string().optional(),
  /** Optional custom consent-denied event name */
  custom_deny_event: z.string().optional(),
})

export type Ga4ConsentHealthInput = z.infer<typeof ga4ConsentHealthInputSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface ConsentStorageStats {
  granted_pct: number
  denied_pct: number
  unset_pct: number
  total_sessions: number
}

export interface ConsentModeData {
  analytics_storage: ConsentStorageStats
  ads_storage: ConsentStorageStats
  available: boolean
}

export interface CustomEventData {
  grant_event: string
  grant_count: number
  deny_event: string
  deny_count: number
  consent_rate_pct: number
}

export interface Ga4ConsentHealthOutput {
  success: boolean
  property_id: string
  period: string
  consent_mode: ConsentModeData
  custom_events?: CustomEventData
  health_score: 'healthy' | 'warning' | 'critical'
  error?: string
}

// ============================================================================
// GA4 Data API Types
// ============================================================================

interface DimensionValue {
  value: string
}

interface MetricValue {
  value: string
}

interface DataApiRow {
  dimensionValues: DimensionValue[]
  metricValues: MetricValue[]
}

interface DataApiResponse {
  rows?: DataApiRow[]
}

// ============================================================================
// Health Score Logic
// ============================================================================

/**
 * Compute health score based on analytics_storage denied percentage
 */
export function computeHealthScore(
  deniedPct: number,
): 'healthy' | 'warning' | 'critical' {
  if (deniedPct > 30) return 'critical'
  if (deniedPct >= 10) return 'warning'
  return 'healthy'
}

// ============================================================================
// Consent Mode Report Processing
// ============================================================================

/**
 * Parse consent mode report rows into storage stats
 */
export function parseConsentModeRows(rows: DataApiRow[]): {
  analytics_storage: ConsentStorageStats
  ads_storage: ConsentStorageStats
  available: boolean
} {
  if (rows.length === 0) {
    const empty: ConsentStorageStats = {
      granted_pct: 0,
      denied_pct: 0,
      unset_pct: 0,
      total_sessions: 0,
    }
    return {
      analytics_storage: empty,
      ads_storage: empty,
      available: false,
    }
  }

  // Aggregate sessions by analytics_storage and ads_storage consent values
  // Dimensions: [0]=privacyInfoAnalyticsStorage, [1]=privacyInfoAdsStorage
  const analyticsMap = new Map<string, number>()
  const adsMap = new Map<string, number>()

  for (const row of rows) {
    const analyticsVal = row.dimensionValues[0]?.value ?? 'UNSET'
    const adsVal = row.dimensionValues[1]?.value ?? 'UNSET'
    const sessions = parseInt(row.metricValues[0]?.value ?? '0', 10)

    analyticsMap.set(analyticsVal, (analyticsMap.get(analyticsVal) ?? 0) + sessions)
    adsMap.set(adsVal, (adsMap.get(adsVal) ?? 0) + sessions)
  }

  const toStats = (map: Map<string, number>): ConsentStorageStats => {
    const granted = map.get('GRANTED') ?? 0
    const denied = map.get('DENIED') ?? 0
    // Any value not GRANTED or DENIED counts as unset
    let unset = 0
    for (const [key, val] of map) {
      if (key !== 'GRANTED' && key !== 'DENIED') {
        unset += val
      }
    }
    const total = granted + denied + unset

    if (total === 0) {
      return { granted_pct: 0, denied_pct: 0, unset_pct: 0, total_sessions: 0 }
    }

    return {
      granted_pct: Math.round((granted / total) * 1000) / 10,
      denied_pct: Math.round((denied / total) * 1000) / 10,
      unset_pct: Math.round((unset / total) * 1000) / 10,
      total_sessions: total,
    }
  }

  // Check if consent mode data is meaningful (not all UNSET)
  const analyticsGranted = analyticsMap.get('GRANTED') ?? 0
  const analyticsDenied = analyticsMap.get('DENIED') ?? 0
  const available = analyticsGranted > 0 || analyticsDenied > 0

  return {
    analytics_storage: toStats(analyticsMap),
    ads_storage: toStats(adsMap),
    available,
  }
}

// ============================================================================
// Custom Event Processing
// ============================================================================

/**
 * Parse custom event rows into CustomEventData
 */
export function parseCustomEventRows(
  rows: DataApiRow[],
  grantEvent: string,
  denyEvent: string,
): CustomEventData {
  let grantCount = 0
  let denyCount = 0

  for (const row of rows) {
    const eventName = row.dimensionValues[0]?.value ?? ''
    const count = parseInt(row.metricValues[0]?.value ?? '0', 10)
    if (eventName === grantEvent) grantCount += count
    if (eventName === denyEvent) denyCount += count
  }

  const total = grantCount + denyCount
  const consent_rate_pct =
    total > 0 ? Math.round((grantCount / total) * 1000) / 10 : 0

  return {
    grant_event: grantEvent,
    grant_count: grantCount,
    deny_event: denyEvent,
    deny_count: denyCount,
    consent_rate_pct,
  }
}

// ============================================================================
// API Calls
// ============================================================================


/**
 * Run a GA4 Data API report
 */
export async function runDataApiReport(
  propertyId: string,
  body: Record<string, unknown>,
): Promise<DataApiRow[]> {
  const authHeaders = await getGoogleAuthHeaders([
    'https://www.googleapis.com/auth/analytics.readonly',
  ])

  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 403) {
      throw new Error(
        'GA4 Data API access denied — check service account has Viewer role on property',
      )
    }
    if (response.status === 404) {
      throw new Error(
        `Property not found: ${propertyId} — verify the property ID is correct`,
      )
    }
    throw new Error(`GA4 Data API error (HTTP ${response.status}): ${text}`)
  }

  const data = (await response.json()) as DataApiResponse
  return data.rows ?? []
}

// ============================================================================
// Main Tool Function
// ============================================================================

/**
 * Run the full ga4_consent_health tool
 */
export async function runGa4ConsentHealth(
  input: Ga4ConsentHealthInput,
): Promise<Ga4ConsentHealthOutput> {
  const { property_id, days, custom_grant_event, custom_deny_event } = input
  const period = `last ${days} days`
  const endDate = 'today'
  const startDate = `${days}daysAgo`

  const emptyConsentMode: ConsentModeData = {
    analytics_storage: {
      granted_pct: 0,
      denied_pct: 0,
      unset_pct: 0,
      total_sessions: 0,
    },
    ads_storage: {
      granted_pct: 0,
      denied_pct: 0,
      unset_pct: 0,
      total_sessions: 0,
    },
    available: false,
  }

  try {
    // Call 1: Consent Mode signals
    const consentRows = await runDataApiReport(property_id, {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: 'privacyInfoAnalyticsStorage' },
        { name: 'privacyInfoAdsStorage' },
      ],
      metrics: [{ name: 'sessions' }],
    })

    const consent_mode = parseConsentModeRows(consentRows)

    // Call 2: Custom events (only if requested)
    let custom_events: CustomEventData | undefined
    if (custom_grant_event || custom_deny_event) {
      const grantEvent = custom_grant_event ?? ''
      const denyEvent = custom_deny_event ?? ''

      // Build event name filter
      const filterValues = [grantEvent, denyEvent].filter(Boolean)
      const eventRows = await runDataApiReport(property_id, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            inListFilter: {
              values: filterValues,
            },
          },
        },
      })

      custom_events = parseCustomEventRows(eventRows, grantEvent, denyEvent)
    }

    const health_score = computeHealthScore(
      consent_mode.analytics_storage.denied_pct,
    )

    return {
      success: true,
      property_id,
      period,
      consent_mode,
      custom_events,
      health_score,
    }
  } catch (err) {
    return {
      success: false,
      property_id,
      period,
      consent_mode: emptyConsentMode,
      health_score: 'critical',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

export const ga4ConsentHealthTool = {
  name: 'ga4_consent_health',
  description:
    'Report Consent Mode v2 health for a GA4 property: what % of sessions have analytics/ads consent granted vs denied. ' +
    'Uses GA4 Data API (analyticsdata/v1beta). ' +
    'Returns health score: healthy (<10% denied), warning (10-30%), critical (>30%).',
  inputSchema: {
    type: 'object',
    required: ['property_id'],
    properties: {
      property_id: {
        type: 'string',
        description: 'GA4 property ID in format "properties/123456789"',
      },
      days: {
        type: 'number',
        description: 'Number of days to analyze (default: 28, max: 365)',
        default: 28,
        minimum: 1,
        maximum: 365,
      },
      custom_grant_event: {
        type: 'string',
        description:
          'Optional: custom event name for consent granted (e.g. "consent_granted")',
      },
      custom_deny_event: {
        type: 'string',
        description:
          'Optional: custom event name for consent denied (e.g. "consent_denied")',
      },
    },
  },
}
