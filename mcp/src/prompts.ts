/**
 * MCP prompts: reusable monitoring routines that tell the agent which of this
 * server's tools to call, in what order, and how to decide.
 *
 * getPrompt() is a pure builder (no I/O) so the text can be unit-tested; the
 * server in ./index.ts only wires it to prompts/list and prompts/get.
 */

export interface PromptArgument {
  name: string
  description: string
  required: boolean
}

export interface PromptDefinition {
  name: string
  title: string
  description: string
  arguments: PromptArgument[]
}

// A type alias (not an interface): the SDK's handler result needs an index signature.
export type PromptResult = {
  description: string
  messages: { role: 'user'; content: { type: 'text'; text: string } }[]
}

/** Thrown for an unknown prompt or bad arguments; index.ts maps it to -32602. */
export class PromptError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const SITE: PromptArgument = {
  name: 'site',
  description: 'Search Console site: sc-domain:example.com or https://example.com/',
  required: true,
}
const CONFIG: PromptArgument = {
  name: 'config',
  description:
    'Path to the YAML config for this site (search_console.site_url and url_inspection.priority_urls). gsc_health, gsc_ctr_anomaly, gsc_cannibalization and gsc_monitor_urls take it instead of a site.',
  required: true,
}
const GA4_PROPERTY: PromptArgument = {
  name: 'ga4_property',
  description: 'GA4 property ID (numeric or properties/N). Skips the GA4 steps when omitted.',
  required: false,
}
const ADSENSE_ACCOUNT: PromptArgument = {
  name: 'adsense_account',
  description: 'AdSense account name (accounts/pub-...). Skips the AdSense steps when omitted.',
  required: false,
}

export const PROMPTS: PromptDefinition[] = [
  {
    name: 'daily_briefing',
    title: 'Daily briefing',
    description:
      'Silent-unless-broken daily check: Search Console health, GA4 sessions vs 7-day mean, AdSense yesterday vs the same weekday a week earlier (complete days only).',
    arguments: [SITE, CONFIG, GA4_PROPERTY, ADSENSE_ACCOUNT],
  },
  {
    name: 'weekly_review',
    title: 'Weekly review',
    description:
      'Weekly Search Console review: traffic week over week, CTR anomalies, cannibalization, deindexed pages. Ends with exactly one decision.',
    arguments: [SITE, CONFIG, GA4_PROPERTY, ADSENSE_ACCOUNT],
  },
  {
    name: 'core_update_check',
    title: 'Core update check',
    description:
      'Assess the impact of a Google core update following Google guidance. Returns a verdict: no-action, review or act.',
    arguments: [
      SITE,
      CONFIG,
      GA4_PROPERTY,
      ADSENSE_ACCOUNT,
      {
        name: 'rollout_start',
        description: 'Core update rollout start date (YYYY-MM-DD), from the Search Status Dashboard',
        required: true,
      },
      {
        name: 'rollout_end',
        description: 'Core update rollout end date (YYYY-MM-DD), from the Search Status Dashboard',
        required: true,
      },
    ],
  },
]

function clean(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

const GA4_DATE_NOTE =
  'The tool only takes a relative window ending yesterday, so size days to reach the oldest date you need and sum the date rows per window yourself.'

/** Add days to a YYYY-MM-DD date (UTC, so DST never shifts the result). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function dailyBriefing(site: string, config: string, ga4?: string, adsense?: string): string {
  const steps = [
    `1. Call gsc_health with config=${config} (the YAML config for ${site}, with the priority URLs). Note any URL whose indexing status regressed or any new canonical problem.`,
  ]
  if (ga4) {
    steps.push(
      `${steps.length + 1}. Call ga4_traffic_report with property_id=${ga4}, days=8, dimensions=["date"], limit=8. Compare yesterday's sessions (the newest date row) with the mean of the 7 date rows before it. Alert when yesterday is more than 30% below that mean.`,
    )
  }
  if (adsense) {
    steps.push(
      `${steps.length + 1}. Call adsense_report for account ${adsense} with date_range CUSTOM, start_date = yesterday minus 7 days, end_date = yesterday, dimensions DATE. Compare the two complete days at the ends of that range: yesterday and the same weekday one week earlier. Alert when yesterday's earnings are more than 30% lower. Do not use today: it is a partial day and would alert falsely.`,
    )
  }
  return `Run the daily briefing for ${site}.

Steps, in order:
${steps.join('\n')}

Decision rules:
- Output ONLY alerts. Each alert is one line: what broke, the numbers, and the single next tool or action to take.
- If every check is green, output nothing at all (no summary, no "all good").
- If a tool fails, report that as an alert instead of guessing.`
}

function weeklyReview(site: string, config: string, ga4?: string, adsense?: string): string {
  const extras: string[] = []
  if (ga4) {
    extras.push(
      `Also call ga4_traffic_report with property_id=${ga4}, days=21, dimensions=["date"], limit=100. ${GA4_DATE_NOTE} Sum sessions over the period_a dates and over the period_b dates to confirm whether sessions moved with clicks.`,
    )
  }
  if (adsense) {
    extras.push(
      `Also call adsense_report for account ${adsense} (CUSTOM over the period_a and period_b dates, dimensions DATE) to see whether revenue followed traffic.`,
    )
  }
  if (ga4) {
    extras.push(
      `Call ga4_annotations with property=${ga4}, action="list", since = 35 days before today. Skip systemGenerated annotations (Google's own notices). For each decision annotated 7-28 days ago, call gsc_traffic_compare with site=${site}, around={date:<annotation date>, window_days:7} and pages=[<the annotated URL>] and report its before_after block: did the change help?`,
    )
  }
  const extraSteps = extras.map((e, i) => `${6 + i}. ${e}\n`).join('')
  return `Run the weekly review for ${site} (config: ${config}).

Search Console data lags 2-3 days, so the last 2-3 days are incomplete. Compute concrete YYYY-MM-DD dates from today and define two windows of 7 days each:
- period_b (current) = the latest 7 FULL reported days, ending 3 days before today.
- period_a (baseline) = the 7 days immediately before period_b.
gsc_traffic_compare treats period_a as the older baseline and period_b as the newer period, and computes every delta as period_b minus period_a: a NEGATIVE clicks_delta or a POSITIVE position_delta (position got worse) means decline.

Steps, in order:
1. gsc_traffic_compare with site=${site}, period_a={start,end}, period_b={start,end} as above, dimensions=["page"]. Flag the pages and queries that moved most.
2. gsc_ctr_anomaly with config=${config}, days=7: pages whose CTR is out of line for their position.
3. gsc_cannibalization with config=${config}: queries where several URLs compete.
4. gsc_health with config=${config}: its regressions are the newly excluded or deindexed priority URLs (it diffs against the stored snapshot). Optionally add gsc_monitor_urls with config=${config} for a fresh inspection, and gsc_index_coverage with site=${site}, days=7, state="no_impressions" as supporting evidence only: it is built from impressions and cannot tell newly excluded from long-excluded pages.
5. gsc_decay with config=${config}: query/page pairs whose position slipped and clicks fell over the last 28 days, the refresh candidates.
${extraSteps}
Alert thresholds:
- Clicks down more than 30% week over week, only when the baseline (period_a) had at least 50 clicks.
- Average position worse by more than 3, only for pages or queries with at least 1000 impressions.
- Newly excluded pages (gsc_health regressions): more than 10, or more than 20% of the priority URLs inspected.
Below a threshold, treat the movement as noise.

Output:
- A short list of the alerts that fired (or "no alerts").
- Then propose exactly ONE decision for the coming week, the one with the best expected payoff, chosen from: title rewrite, content refresh, internal link, consolidate pages, publish a new page. Name the URL(s) and the evidence from the tools above.
- Record that decision as a GA4 annotation so next week's review can measure it: ${ga4 ? `offer to call ga4_annotations with property=${ga4}, action="create", date = the day the change ships, title = "<change> <URL>" (max 60 chars)` : 'without a GA4 property, give the annotation text (date, URL, change) to add manually'}.`
}

function coreUpdateCheck(
  site: string,
  config: string,
  start: string,
  end: string,
  ga4?: string,
  adsense?: string,
): string {
  // Search Console lags 2-3 days, so the post-update week is only complete 3 days after it ends.
  const beforeStart = addDays(start, -7)
  const beforeEnd = addDays(start, -1)
  const afterStart = addDays(end, 1)
  const afterEnd = addDays(end, 7)
  const waitUntil = addDays(end, 10)
  const extras: string[] = []
  if (ga4) {
    extras.push(
      `Call ga4_traffic_report with property_id=${ga4}, dimensions=["date","sessionDefaultChannelGroup"], limit=1000 and days large enough to reach ${beforeStart} from yesterday. ${GA4_DATE_NOTE} Keep only the "Organic Search" rows and sum their sessions over ${beforeStart}..${beforeEnd} and ${afterStart}..${afterEnd} to check whether organic sessions moved the same way.`,
    )
  }
  if (adsense) {
    extras.push(
      `Use adsense_report for account ${adsense} (CUSTOM from ${beforeStart} to ${afterEnd}, dimensions DATE) to check whether revenue moved with traffic.`,
    )
  }
  const extraSteps = extras.map((e, i) => `${4 + i}. ${e}\n`).join('')
  return `Check the impact of the Google core update that rolled out from ${start} to ${end} on ${site} (config: ${config}).

Google's guidance is to wait at least one full week after the rollout completes before analyzing Search Console data, and Search Console lags 2-3 days. If today is before ${waitUntil}, stop and answer: wait until ${waitUntil}. Do not call any tool.

Otherwise:
1. gsc_traffic_compare with site=${site}, period_a={start:"${beforeStart}",end:"${beforeEnd}"} (baseline, the 7 days before the rollout) and period_b={start:"${afterStart}",end:"${afterEnd}"} (current, the 7 days after it), dimensions=["page"]. The tool computes deltas as period_b minus period_a, so a NEGATIVE clicks_delta or a POSITIVE position_delta (worse) means decline. Compare clicks, impressions and average position, site-wide and for the biggest pages and queries.
2. Google advises analyzing search types (web, image, video, news) separately. If any available tool lets you filter by search type (for example gsc_analytics_run), repeat the comparison per type; otherwise say that the split was not possible.
3. If the drop is concentrated in a few pages or queries, look at those with gsc_ctr_anomaly (config=${config}) and gsc_cannibalization (config=${config}) before blaming the update.
${extraSteps}
Decision rules:
- Small movements in position or clicks: no drastic action. Do not rewrite content that already performs well.
- A large drop that is sustained and site-wide: do a deeper helpfulness self-assessment. Is the site delivering content that is helpful, reliable and people first? Review the most-affected pages against Google's guidance on creating helpful content.
- Give a final verdict, exactly one of:
  - no-action: changes are small or within normal weekly variation.
  - review: a notable drop, limited to some sections or search types; review those pages.
  - act: a large, sustained, site-wide drop; start the helpfulness self-assessment and plan improvements.
Back the verdict with the numbers. Rollout dates come from the Search Status Dashboard; do not assume them.`
}

/** Build the message for prompt `name`. Throws PromptError on unknown names or bad arguments. */
export function getPrompt(name: string, args: Record<string, string> = {}): PromptResult {
  const def = PROMPTS.find((p) => p.name === name)
  if (!def) throw new PromptError(`Unknown prompt: ${name}`)

  const missing = def.arguments.filter((a) => a.required && !clean(args[a.name])).map((a) => a.name)
  if (missing.length) throw new PromptError(`Missing required arguments: ${missing.join(', ')}`)

  const site = clean(args.site)!
  const config = clean(args.config)!
  const ga4 = clean(args.ga4_property)
  const adsense = clean(args.adsense_account)

  let text: string
  if (name === 'daily_briefing') {
    text = dailyBriefing(site, config, ga4, adsense)
  } else if (name === 'weekly_review') {
    text = weeklyReview(site, config, ga4, adsense)
  } else {
    const start = clean(args.rollout_start)!
    const end = clean(args.rollout_end)!
    for (const [label, value] of [
      ['rollout_start', start],
      ['rollout_end', end],
    ]) {
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
        throw new PromptError(`${label} must be a date in YYYY-MM-DD format`)
      }
    }
    if (end < start) throw new PromptError('rollout_end must not be before rollout_start')
    text = coreUpdateCheck(site, config, start, end, ga4, adsense)
  }

  return {
    description: def.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  }
}
