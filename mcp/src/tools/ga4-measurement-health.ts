import { z } from 'zod'
import { native } from '../tool-spec.js'
import type { CLIExecutor } from '../cli/executor.js'
import { runReport, type DataApiResponse } from '../utils/ga4-data-client.js'
import { getPropertySettings, GSC_TIME_ZONE, type Ga4PropertySettings } from '../utils/ga4-admin-client.js'
import { ToolError, type ToolFailureResult } from '../utils/errors.js'
import { computeConsentHealth } from './compute-consent-health.js'
import {
  ORGANIC_CHANNEL,
  ORGANIC_FILTER,
  propertyShape,
  propertyJsonProps,
  resolvePropertyId,
  windows,
  dateRange,
  num,
  dim,
  round,
  guard,
  type DateWindow,
} from './ga4-organic-shared.js'
import { SITE_SEARCH_EVENT } from './ga4-organic-reports.js'

/**
 * ga4_measurement_health: can this property answer organic-SEO questions at
 * all? Each check explains an empty or suspicious result and how to fix it,
 * so an agent does not read "0 organic sessions" as "no organic traffic".
 */

export const ga4MeasurementHealthInputSchema = z.object({
  ...propertyShape,
  grant_event: z.string().min(1).optional().describe('Custom consent-granted event name, if the site sends one.'),
  deny_event: z.string().min(1).optional().describe('Custom consent-denied event name, if the site sends one.'),
})
export type Ga4MeasurementHealthInput = z.infer<typeof ga4MeasurementHealthInputSchema>

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface HealthCheck {
  check: string
  status: CheckStatus
  detail: string
  how_to_fix: string | null
}

export type Ga4MeasurementHealthResult =
  | {
      success: true
      warnings: string[]
      property_id: string
      window: DateWindow
      overall: CheckStatus
      property: { display_name: string | null; time_zone: string | null; currency_code: string | null } | null
      checks: HealthCheck[]
    }
  | ToolFailureResult

/** Event names that suggest a consent banner reports its choices to GA4. */
const CONSENT_EVENT_RE = /consent|cookie|cmp|gdpr/i

export interface HealthInputs {
  channels: DataApiResponse
  events: DataApiResponse
  freshness: DataApiResponse
  landing: DataApiResponse
  settings: Ga4PropertySettings | null
  settingsError: string | null
  today: string
  days: number
  grant_event?: string
  deny_event?: string
}

const DAY_MS = 86_400_000

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS)
}

/** Pure: turn the report responses into checks. */
export function evaluateHealth(h: HealthInputs): HealthCheck[] {
  const checks: HealthCheck[] = []

  // 1. Sessions at all, and organic sessions.
  let total = 0
  let organic = 0
  for (const row of h.channels.rows ?? []) {
    const s = num(row, 0)
    total += s
    if (dim(row, 0) === ORGANIC_CHANNEL) organic = s
  }
  if (total === 0) {
    checks.push({
      check: 'sessions_recorded',
      status: 'fail',
      detail: `GA4 recorded no sessions in the last ${h.days} days.`,
      how_to_fix: 'The tag is not firing or this is the wrong property: check the measurement ID on the site matches a web stream of this property (GA4 Admin → Data streams), and use Realtime to confirm hits.',
    })
  } else {
    checks.push({ check: 'sessions_recorded', status: 'pass', detail: `${total} sessions in the last ${h.days} days.`, how_to_fix: null })
  }
  if (total > 0) {
    const share = organic / total
    checks.push(
      organic === 0
        ? {
            check: 'organic_sessions',
            status: 'fail',
            detail: 'GA4 has no Organic Search sessions in the window, although it has other sessions.',
            how_to_fix:
              'Search referrers are being lost or reclassified: check Referrer-Policy is not "no-referrer", that landing pages do not redirect through a tracker, ' +
              'that a custom channel group is not hiding Organic Search, and that GA4 is linked to Search Console (Admin → Product links).',
          }
        : {
            check: 'organic_sessions',
            status: share < 0.02 ? 'warn' : 'pass',
            detail: `${organic} Organic Search sessions (${round(share * 100, 1)}% of all sessions).`,
            how_to_fix: share < 0.02 ? 'A very low organic share often means referrers are stripped; compare with Search Console clicks for the same window.' : null,
          },
    )
  }

  // 2. Key events.
  let keyEventsTotal = 0
  const keyEventNames: string[] = []
  const consentEvents: string[] = []
  let siteSearch = 0
  for (const row of h.events.rows ?? []) {
    const name = dim(row, 0)
    const ke = num(row, 1)
    if (ke > 0) {
      keyEventsTotal += ke
      keyEventNames.push(name)
    }
    if (CONSENT_EVENT_RE.test(name)) consentEvents.push(name)
    if (name === SITE_SEARCH_EVENT) siteSearch = num(row, 0)
  }
  checks.push(
    keyEventsTotal > 0
      ? { check: 'key_events', status: 'pass', detail: `${keyEventsTotal} key events (${keyEventNames.slice(0, 5).join(', ')}).`, how_to_fix: null }
      : {
          check: 'key_events',
          status: 'warn',
          detail: 'No key events recorded: either none is configured or none happened.',
          how_to_fix: 'Mark the events that matter (sign_up, generate_lead, purchase…) as key events in GA4 Admin → Data display → Events. Without them, business value in page_opportunities falls back to engagement.',
        },
  )

  // 3. Consent.
  if (h.grant_event && h.deny_event) {
    const rows = (h.events.rows ?? []).map((r) => ({ dimensionValues: r.dimensionValues, metricValues: [r.metricValues[0], { value: '0' }] }))
    const c = computeConsentHealth(rows, { grant_event: h.grant_event, deny_event: h.deny_event, view_event: 'page_view' })
    checks.push(
      !c.available
        ? {
            check: 'consent',
            status: 'warn',
            detail: `No "${h.grant_event}" or "${h.deny_event}" events in the window.`,
            how_to_fix: 'Fire the grant/deny events from the consent banner, or check the event names.',
          }
        : {
            check: 'consent',
            status: c.health_score === 'critical' ? 'warn' : 'pass',
            detail: `Consent rate ${c.consent_rate_pct}% (${c.health_score}).`,
            how_to_fix: c.health_score === 'critical' ? 'Most visitors deny consent, so GA4 undercounts; enable Consent Mode v2 modeling (needs volume thresholds) and read trends, not absolutes.' : null,
          },
    )
  } else if (consentEvents.length > 0) {
    checks.push({
      check: 'consent',
      status: 'pass',
      detail: `Consent-related events are recorded (${consentEvents.slice(0, 5).join(', ')}). Pass grant_event and deny_event to get a consent rate.`,
      how_to_fix: null,
    })
  } else {
    checks.push({
      check: 'consent',
      status: 'warn',
      detail: 'No consent events found, and the Data API does not expose Consent Mode state, so consent cannot be verified from GA4.',
      how_to_fix: 'If the site uses a consent banner, send its choice as events (e.g. consent_granted / consent_denied) and re-run with grant_event and deny_event. Denied consent lowers every GA4 count.',
    })
  }

  // 4. Freshness.
  let last: string | null = null
  for (const row of h.freshness.rows ?? []) {
    const d = dim(row, 0)
    if (num(row, 0) > 0 && /^\d{8}$/.test(d)) {
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      if (!last || iso > last) last = iso
    }
  }
  if (!last) {
    checks.push({
      check: 'data_freshness',
      status: 'fail',
      detail: 'No sessions in the last 10 days.',
      how_to_fix: 'The tag stopped firing (deploy removed it, CSP blocks googletagmanager.com, or consent blocks all hits).',
    })
  } else {
    const lag = daysBetween(last, h.today)
    checks.push({
      check: 'data_freshness',
      status: lag <= 2 ? 'pass' : lag <= 7 ? 'warn' : 'fail',
      detail: `Last day with sessions: ${last} (${lag} day(s) ago).`,
      how_to_fix: lag <= 2 ? null : 'Recent days are missing: check the tag still fires on every template (Realtime report) and that consent is not blocking all hits.',
    })
  }

  // 5. Landing page "(not set)".
  const organicLanding = (h.landing.rows ?? []).reduce((a, r) => a + num(r, 0), 0)
  const notSet = (h.landing.rows ?? []).find((r) => dim(r, 0) === '(not set)')
  if (organicLanding > 0) {
    const share = notSet ? num(notSet, 0) / organicLanding : 0
    checks.push({
      check: 'organic_landing_pages',
      status: share > 0.1 ? 'warn' : 'pass',
      detail: `${round(share * 100, 1)}% of organic sessions have landing page "(not set)".`,
      how_to_fix: share > 0.1 ? 'Sessions start without a page_view: make sure the config tag (page_view) fires before other events on every page.' : null,
    })
  }

  // 6. Site search (informational).
  checks.push(
    siteSearch > 0
      ? { check: 'site_search', status: 'pass', detail: `${siteSearch} site searches recorded.`, how_to_fix: null }
      : {
          check: 'site_search',
          status: 'warn',
          detail: 'No view_search_results events: site search is not tracked (or the site has no search).',
          how_to_fix: 'Enable Enhanced measurement → Site search on the web stream and list the search query parameter.',
        },
  )

  // 7. Time zone.
  if (!h.settings) {
    checks.push({
      check: 'time_zone',
      status: 'warn',
      detail: `Could not read property settings: ${h.settingsError ?? 'unknown error'}.`,
      how_to_fix: 'Grant Viewer on the property and enable the Analytics Admin API, so reports can align GA4 and Search Console dates.',
    })
  } else {
    const tz = h.settings.time_zone
    checks.push({
      check: 'time_zone',
      status: tz && tz !== GSC_TIME_ZONE ? 'warn' : 'pass',
      detail:
        tz && tz !== GSC_TIME_ZONE
          ? `Property time zone is ${tz}; Search Console reports in ${GSC_TIME_ZONE}, so daily GA4 × GSC joins can be off by a day.`
          : `Property time zone is ${tz ?? 'unknown'}.`,
      how_to_fix: tz && tz !== GSC_TIME_ZONE ? 'Compare weekly or longer windows when joining GA4 with Search Console.' : null,
    })
  }

  return checks
}

export function overallStatus(checks: HealthCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'pass'
}

export async function runGa4MeasurementHealth(input: Ga4MeasurementHealthInput, executor: CLIExecutor, now: Date = new Date()) {
  return guard(async (): Promise<Exclude<Ga4MeasurementHealthResult, ToolFailureResult>> => {
    const propertyId = await resolvePropertyId(input, executor)
    const { current } = windows(input.days, now)
    const today = now.toISOString().slice(0, 10)
    const freshStart = new Date(Date.parse(today) - 10 * DAY_MS).toISOString().slice(0, 10)

    const [channels, events, freshness, landing, settingsResult] = await Promise.all([
      runReport(propertyId, { dateRanges: [dateRange(current)], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], limit: 100 }),
      runReport(propertyId, {
        dateRanges: [dateRange(current)],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 500,
      }),
      runReport(propertyId, { dateRanges: [{ startDate: freshStart, endDate: today }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }], limit: 20 }),
      runReport(propertyId, {
        dateRanges: [dateRange(current)],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: ORGANIC_FILTER,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 1000,
      }),
      getPropertySettings(propertyId).then(
        (s) => ({ settings: s, error: null as string | null }),
        (e: unknown) => ({ settings: null, error: e instanceof ToolError || e instanceof Error ? e.message : String(e) }),
      ),
    ])

    const checks = evaluateHealth({
      channels,
      events,
      freshness,
      landing,
      settings: settingsResult.settings,
      settingsError: settingsResult.error,
      today,
      days: input.days,
      grant_event: input.grant_event,
      deny_event: input.deny_event,
    })
    const s = settingsResult.settings
    return {
      success: true,
      warnings: checks.filter((c) => c.status !== 'pass').map((c) => `${c.check}: ${c.detail}`),
      property_id: propertyId,
      window: current,
      overall: overallStatus(checks),
      property: s ? { display_name: s.display_name, time_zone: s.time_zone, currency_code: s.currency_code } : null,
      checks,
    }
  })
}

export const ga4MeasurementHealthTool = {
  name: 'ga4_measurement_health',
  description:
    'Use before trusting any GA4 organic numbers, or when a GA4 report comes back empty: checks whether the property records sessions at all, ' +
    'Organic Search sessions (and their share), key events, consent signals, data freshness (last day with sessions), "(not set)" landing pages, ' +
    'site search, and the property time zone versus Search Console\'s Pacific Time. Each check is pass/warn/fail with a detail and how_to_fix. ' +
    'Read-only; 4 Data API reports + 1 Admin API read.',
  inputSchema: {
    type: 'object',
    properties: {
      ...propertyJsonProps,
      grant_event: { type: 'string', description: 'Custom consent-granted event name, e.g. "consent_granted" (optional).' },
      deny_event: { type: 'string', description: 'Custom consent-denied event name, e.g. "consent_denied" (optional).' },
    },
  },
  annotations: { title: 'GA4 measurement health', readOnlyHint: true, openWorldHint: true },
}

export const ga4MeasurementHealthSpec = native({
  tool: ga4MeasurementHealthTool,
  schema: ga4MeasurementHealthInputSchema,
  run: async (input, executor) => {
    const output = await runGa4MeasurementHealth(input, executor)
    return { output, isError: !output.success }
  },
})
