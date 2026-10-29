// Pure function: map GA4 Data API event rows to consent health metrics.

export interface ConsentEventStats {
  name: string
  event_count: number
  total_users: number
}

export interface ConsentHealthResult {
  events: {
    grant_event: ConsentEventStats
    deny_event: ConsentEventStats
    view_event?: ConsentEventStats
  }
  consent_rate_pct: number | null
  consent_visibility_pct: number | null
  health_score: 'healthy' | 'warning' | 'critical' | 'no_data'
  available: boolean
  warnings: string[]
}

export interface ConsentReportRow {
  dimensionValues: { value: string }[]
  metricValues: { value: string }[]
}

export interface ConsentEventNames {
  grant_event: string
  deny_event: string
  view_event: string
}

/**
 * Map GA4 Data API rows to consent health metrics.
 *
 * Rows are expected to have eventName as dimension[0], eventCount as metric[0],
 * totalUsers as metric[1].
 */
export function computeConsentHealth(
  rows: ConsentReportRow[],
  eventNames: ConsentEventNames,
): ConsentHealthResult {
  const { grant_event, deny_event, view_event } = eventNames
  const warnings: string[] = []

  const eventMap = new Map<string, { event_count: number; total_users: number }>()
  for (const row of rows) {
    const name = row.dimensionValues[0]?.value ?? ''
    const eventCount = parseInt(row.metricValues[0]?.value ?? '0', 10)
    const totalUsers = parseInt(row.metricValues[1]?.value ?? '0', 10)
    eventMap.set(name, { event_count: eventCount, total_users: totalUsers })
  }

  const grantStats = eventMap.get(grant_event) ?? { event_count: 0, total_users: 0 }
  const denyStats = eventMap.get(deny_event) ?? { event_count: 0, total_users: 0 }
  const viewStats = eventMap.get(view_event)

  const grantCount = grantStats.event_count
  const denyCount = denyStats.event_count
  const totalConsent = grantCount + denyCount
  const available = totalConsent > 0

  const consent_rate_pct =
    totalConsent > 0 ? Math.round((grantCount / totalConsent) * 1000) / 10 : null

  let consent_visibility_pct: number | null = null
  if (viewStats !== undefined && viewStats.event_count > 0) {
    consent_visibility_pct =
      Math.round((totalConsent / viewStats.event_count) * 1000) / 10
  }

  let health_score: ConsentHealthResult['health_score']
  if (!available) {
    health_score = 'no_data'
  } else if (consent_rate_pct !== null && consent_rate_pct >= 80) {
    health_score = 'healthy'
  } else if (consent_rate_pct !== null && consent_rate_pct >= 50) {
    health_score = 'warning'
  } else {
    health_score = 'critical'
  }

  if (available && (grantCount === 0 || denyCount === 0)) {
    warnings.push(
      'only one consent event observed; banner instrumentation may be incomplete',
    )
  }

  const events: ConsentHealthResult['events'] = {
    grant_event: { name: grant_event, ...grantStats },
    deny_event: { name: deny_event, ...denyStats },
  }
  if (viewStats !== undefined) {
    events.view_event = { name: view_event, ...viewStats }
  }

  return {
    events,
    consent_rate_pct,
    consent_visibility_pct,
    health_score,
    available,
    warnings,
  }
}
