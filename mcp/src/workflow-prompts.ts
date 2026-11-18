/**
 * Workflow prompts (item 11): the multi-step SEO routines OpenSEO ships as
 * agent skills, rebuilt on this server's tools. Each prompt tells the agent
 * which tools to chain, in what order, how to spend, and what to hand back.
 *
 * Shared rules baked into every paid workflow:
 *   - read project_context_get first and reuse its research log, so nothing
 *     already bought is bought again (repeats inside the TTL are cached anyway);
 *   - run each paid tool with estimate_only: true, show the estimate, and only
 *     then run it for real within max_cost_usd;
 *   - record what was learned with project_context_update.
 *
 * Pure builders: no I/O, so the text is unit-tested (workflow-prompts.test.ts
 * also checks that every tool a prompt names is registered).
 */

import type { PromptArgument, PromptDefinition } from './prompts.js'

export class WorkflowPromptError extends Error {}

const SITE: PromptArgument = { name: 'site', description: 'The site: example.com (or sc-domain:example.com)', required: true }
const CONFIG: PromptArgument = { name: 'config', description: 'Optional YAML config for the site (search_console.site_url, ga4.property_id); enables the GSC and GA4 steps', required: false }
const GA4: PromptArgument = { name: 'ga4_property', description: 'Optional GA4 property ID, when there is no config', required: false }
const MARKET_LOCATION: PromptArgument = { name: 'location', description: 'Market location name, e.g. "United States" or "Spain" (default United States)', required: false }
const MARKET_LANGUAGE: PromptArgument = { name: 'language', description: 'Language code, e.g. en or es (default en)', required: false }

export const WORKFLOW_PROMPTS: PromptDefinition[] = [
  {
    name: 'project_setup',
    title: 'Project setup',
    description: 'Create the shared project context for a site: brand, goal, positioning, competitors and key pages, from Search Console, GA4 and a quick crawl. Free.',
    arguments: [SITE, CONFIG, GA4, { name: 'competitors', description: 'Optional comma-separated competitor domains', required: false }],
  },
  {
    name: 'seo_audit',
    title: 'SEO audit',
    description: 'Crawl the site in the background, read site-wide issues and Lighthouse, cross-check with Search Console, and return a prioritised fix list. Free.',
    arguments: [SITE, CONFIG, { name: 'start_url', description: 'Crawl start URL (default https://<site>/)', required: false }, { name: 'max_pages', description: 'Page budget (default 500)', required: false }],
  },
  {
    name: 'keyword_research',
    title: 'Keyword research',
    description: 'Find keywords worth targeting from seed topics, Search Console striking-distance queries and competitors, with volumes; save the shortlist. Paid (estimated first).',
    arguments: [SITE, { name: 'seeds', description: 'Comma-separated seed keywords or topics', required: true }, CONFIG, MARKET_LOCATION, MARKET_LANGUAGE],
  },
  {
    name: 'keyword_clustering',
    title: 'Keyword clustering',
    description: 'Group saved keywords into topic clusters by shared ranking URLs, map each cluster to one page (hub/spoke) and flag gaps and cannibalisation. Paid SERP checks (estimated first).',
    arguments: [SITE, { name: 'tag', description: 'Saved-keyword tag to cluster (default: all saved keywords)', required: false }, CONFIG, MARKET_LOCATION, MARKET_LANGUAGE],
  },
  {
    name: 'competitor_analysis',
    title: 'Competitor analysis',
    description: 'Compare the site with one competitor: domain overview, keyword gap, top pages and link gap; end with the three moves that close most of the gap. Paid (estimated first).',
    arguments: [SITE, { name: 'competitor', description: 'Competitor domain, e.g. rival.example', required: true }, MARKET_LOCATION, MARKET_LANGUAGE],
  },
  {
    name: 'competitive_landscape',
    title: 'Competitive landscape',
    description: 'Who actually ranks for the site\'s keyword set: SERP competitors, their size, and where the site stands; updates the competitor list. Paid (estimated first).',
    arguments: [SITE, { name: 'tag', description: 'Saved-keyword tag to analyse (default: all saved keywords)', required: false }, MARKET_LOCATION, MARKET_LANGUAGE],
  },
  {
    name: 'ai_visibility_audit',
    title: 'AI visibility audit',
    description: 'How often ChatGPT, Google AI Overviews / AI Mode and other models mention and cite the site versus competitors; sets up a tracked prompt set. Paid (estimated first).',
    arguments: [SITE, { name: 'topics', description: 'Optional comma-separated topics to build prompts around', required: false }, { name: 'models', description: 'Optional comma-separated models (default chatgpt,google_ai_overview,google_ai_mode)', required: false }, MARKET_LOCATION, MARKET_LANGUAGE],
  },
  {
    name: 'monthly_report',
    title: 'Monthly SEO report',
    description: 'Monthly check-in: organic traffic and outcomes vs the previous month, page opportunities, audit health, rankings and AI visibility, saved as a self-contained HTML report.',
    arguments: [SITE, CONFIG, GA4, { name: 'month', description: 'Month to report, YYYY-MM (default: the last full month)', required: false }],
  },
]

const WORKFLOW_NAMES = new Set(WORKFLOW_PROMPTS.map((p) => p.name))

export function isWorkflowPrompt(name: string): boolean {
  return WORKFLOW_NAMES.has(name)
}

const SPEND_RULES = (site: string) => `Spending rules (DataForSEO is paid):
- Before any paid tool, call project_context_get with site=${site} and read research.recent_lookups. Do not buy a lookup that is already there unless the user asks for fresh data (repeats are also served from the local cache for 6 h–7 days).
- Call dataforseo_balance once. Then run every paid tool first with estimate_only: true, state the estimate, and run it for real only within max_cost_usd (default per tool). Stop and ask if the whole workflow would exceed $2.
- Paid lookups are logged to the project's research log automatically.`

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

function market(args: Record<string, string>): { location: string; language: string } {
  return { location: args.location?.trim() || 'United States', language: args.language?.trim() || 'en' }
}

function gscSource(site: string, config?: string): string {
  return config ? `config=${config}` : `site=sc-domain:${site}`
}

function lastFullMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return d.toISOString().slice(0, 7)
}

type Builder = (a: Record<string, string>, site: string, now: Date) => string

const BUILDERS: Record<string, Builder> = {
  project_setup: (a, site) => {
    const competitors = list(a.competitors)
    const ga4 = a.config ? `config=${a.config}` : a.ga4_property ? `property_id=${a.ga4_property}` : null
    return `Set up the shared project context for ${site}, so every later agent starts from it.

1. project_context_get with site=${site}. If it already has a filled context, show it and only fill the parts listed in \`missing\`.
2. Learn the site: site_audit_run with start_url=https://${site}/, max_pages=150, background=true; poll site_audit_status until done, then site_audit_pages with sort="inlinks" to find the hub pages and the pages that sell (pricing, product, sign-up, contact).
3. Demand: gsc_analytics_run with ${gscSource(site, a.config)}, dimensions="page", limit=500, and again with dimensions="query", limit=200: the topics the site already ranks for.
4. ${ga4 ? `Outcomes: ga4_organic_landing_pages and ga4_key_events with ${ga4}, then ga4_measurement_health with ${ga4}: which pages convert, and whether key events are configured at all.` : 'Without GA4, skip outcomes and say so in the context.'}
5. Write it down with ONE project_context_update call for site=${site}:
   - brand_name;
   - sections business_overview (what the site offers, to whom), current_goal (one measurable goal, e.g. "grow organic sign-ups"), positioning (how it differs), writing_preferences (tone, language, words to avoid, from the existing pages);
   - competitors: ${competitors.length ? competitors.map((c) => `"${c}"`).join(', ') : 'ask the user for 2–5 competitor domains; if they have none, leave it for the competitive_landscape workflow'};
   - key_pages: the home page and main hubs as "hub", their child pages as "spoke", pricing/product/sign-up pages as "money", each with a topic.
6. Show the final context and the remaining \`missing\` list. Ask the user to correct anything wrong; you inferred it.

Free: no DataForSEO calls in this workflow.`
  },

  seo_audit: (a, site) => {
    const start = a.start_url?.trim() || `https://${site}/`
    const pages = Number(a.max_pages) > 0 ? Number(a.max_pages) : 500
    return `Run an SEO audit of ${site} and return a prioritised fix list.

1. site_audit_list with site=${site}: if an audit finished in the last 7 days, reuse it instead of crawling again.
2. Otherwise site_audit_run with start_url=${start}, max_pages=${pages}, lighthouse=true, lighthouse_pages=5, background=true. Poll site_audit_status every 30–60 s until status is done (stalled → delete and restart once; rate_limited pages mean the server throttled the crawl: rerun with concurrency=1 later, do not call them broken).
3. site_audit_issues with site=${site}, pages_per_issue=10. Errors first, then warnings. Read every how_to_fix.
4. site_audit_lighthouse with site=${site}: mobile scores, LCP/CLS/INP, and the top savings with their resources.
5. Search Console cross-check (${gscSource(site, a.config)}): gsc_url_hygiene (indexed URLs that should not be), gsc_cannibalization, and gsc_index_coverage for pages with no impressions. Give priority to audit issues on pages that earn impressions (gsc_analytics_run, dimensions="page").
6. If crawl-page-limit or crawl-time-limit appears, say the site-wide checks are partial and how to widen them.

Output:
- A table: issue, severity, pages affected, how to fix, effort (S/M/L), impact (pages with impressions affected).
- The top 5 fixes in order, each naming URLs.
- Offer to save it with report_save (site=${site}, title "SEO audit <date>", sections from the tool outputs).
Free: crawling and PageSpeed are free; JS rendering is off unless the site needs it.`
  },

  keyword_research: (a, site) => {
    const seeds = list(a.seeds)
    const m = market(a)
    return `Keyword research for ${site} in ${m.location} (${m.language}), seeds: ${seeds.join(', ')}.

${SPEND_RULES(site)}

1. project_context_get with site=${site}: current_goal, positioning and key_pages decide what "relevant" means.
2. Free first: keyword_suggestions with site=${site}${a.config ? `, config=${a.config}` : ''} (Search Console queries at positions 4–30 not yet saved).
3. serp_locations with query="${m.location}" to get the location_code if a tool needs it.
4. Paid, estimate first: keyword_ideas with keywords=[${seeds.map((s) => `"${s}"`).join(', ')}], location_name="${m.location}", language_code="${m.language}", limit=200.
5. If competitors are in the context: ranked_keywords for the strongest one (limit 200), and keyword_gap with domain=${site}, competitor=<it>.
6. Paid, estimate first: keyword_volume for the final candidate list (≤ 100) if volumes are missing.
7. Shortlist 20–40 keywords: relevant to the goal, realistic difficulty for the site, clear intent. Mark each with intent (informational/commercial/transactional) and the page that should rank (existing key page or "new page").
8. keywords_save with site=${site}, the shortlist, tags ["research-<YYYY-MM>", "<intent>"] and metrics {volume, kd, cpc} from the tools.

Output: the shortlist table (keyword, volume, KD, intent, target page, why), and the 3 new pages worth creating first.`
  },

  keyword_clustering: (a, site) => {
    const m = market(a)
    const tag = a.tag?.trim()
    return `Cluster ${site}'s saved keywords into topics and map each topic to one page.

${SPEND_RULES(site)}

1. keywords_list with site=${site}${tag ? `, tag="${tag}"` : ''}. If fewer than 10 keywords, stop and suggest the keyword_research workflow.
2. Paid, estimate first: rank_tracker_create with site=${site}, name="clustering${tag ? `-${tag}` : ''}", the keywords, location_name="${m.location}", language_code="${m.language}", depth=10 (clustering only needs the top 10), then rank_tracker_estimate and rank_tracker_run. This stores each keyword's top-10 SERP and the site's own ranking URL.
3. Cluster: two keywords belong together when their top-10 results share at least 3 URLs (SERP overlap). Name each cluster by its highest-volume keyword.
4. Map each cluster to one page: the URL the site already ranks with for most of its keywords (rank_tracker_get), else the best key page from project_context_get, else "new page". Mark the main page "hub" and supporting ones "spoke".
5. Flag:
   - cannibalisation: one cluster where the site ranks with 2+ different URLs (confirm with gsc_cannibalization${a.config ? ` config=${a.config}` : ''});
   - gaps: clusters with no page;
   - misfits: keywords that overlap with nothing.
6. Save: keywords_save with tags ["cluster:<name>"] per keyword (replace_tags false), and project_context_update upserting key_pages with role and topic per cluster.

Output: one table per cluster (keywords, volume sum, target page, role, status ranking/gap/cannibalised) and the 3 clusters to work on first.`
  },

  competitor_analysis: (a, site) => {
    const m = market(a)
    const rival = a.competitor.trim()
    return `Compare ${site} with ${rival} in ${m.location} (${m.language}).

${SPEND_RULES(site)}

1. project_context_get with site=${site}; if ${rival} is not a competitor yet, add it later.
2. Paid, estimate first: domain_overview for domain=${site} and for domain=${rival} (include_pages true, pages_limit 10): organic traffic estimate, keywords by position band, top pages.
3. Paid, estimate first: keyword_gap with domain=${site}, competitor=${rival}, location_name="${m.location}", language_code="${m.language}", limit=200: keywords they rank for and the site does not.
4. Paid, estimate first: backlinks_overview with domains=[${site}, ${rival}], then link_gap with domain=${site}, competitors=[${rival}], limit=50.
5. Read their top pages (seo_page_audit on 2–3 of them, free) to see format and depth.

Output:
- Side by side: traffic, keywords in top 3 / 4–10 / 11–20, referring domains, top pages.
- The gap in themes, not just keywords: which topics they own.
- Exactly three moves that close most of the gap (new page, content upgrade, link target), each with the evidence.
- project_context_update: upsert competitor ${rival} with notes summarising strengths; keywords_save the top 20 gap keywords with tags ["gap:${rival}"].`
  },

  competitive_landscape: (a, site) => {
    const m = market(a)
    const tag = a.tag?.trim()
    return `Map who competes with ${site} in search for its keyword set (${m.location}, ${m.language}).

${SPEND_RULES(site)}

1. keywords_list with site=${site}${tag ? `, tag="${tag}"` : ''}. If empty, use keyword_suggestions (free) to get the site's own queries first.
2. Paid, estimate first: serp_competitors with site=${site}${tag ? `, tag="${tag}"` : ''}, location_name="${m.location}", language_code="${m.language}", limit=20: the domains that rank most across the set, with average position and keyword overlap. It marks the site itself and known competitors.
3. Separate real competitors from noise: drop marketplaces, encyclopedias, forums and social sites unless they dominate, and say which you dropped.
4. Paid, estimate first: domain_overview for the top 3 real competitors (include_pages false) to gauge size.
5. project_context_update: upsert the real competitors (domain, label, notes with overlap and average position).

Output: a ranked table (domain, keywords shared, average position, estimated traffic, type: direct competitor / publisher / marketplace / other), where ${site} stands in it, and which competitor to analyse next with the competitor_analysis workflow.`
  },

  ai_visibility_audit: (a, site) => {
    const m = market(a)
    const topics = list(a.topics)
    const models = list(a.models).length ? list(a.models) : ['chatgpt', 'google_ai_overview', 'google_ai_mode']
    return `Audit how AI answers mention and cite ${site} (${m.location}, ${m.language}), models: ${models.join(', ')}.

${SPEND_RULES(site)}

1. project_context_get with site=${site}: brand, competitors and key-page topics feed the prompts.
2. Free: ai_visibility_prompts_generate with site=${site}${topics.length ? `, topics=[${topics.map((t) => `"${t}"`).join(', ')}]` : ''}, max=30. Keep 15–25 prompts a real buyer would ask; drop vague ones.
3. Paid, estimate first: ai_visibility_research with site=${site}, keywords=<3–5 core topics>, location_name="${m.location}", language_code="${m.language}": the questions people actually ask AI and the sources cited. Add the best real questions to the set.
4. Free: ai_visibility_tracker_save with site=${site}, the prompts (tagged by topic), models=[${models.map((x) => `"${x}"`).join(', ')}], brand_terms from the context, competitors from the context.
5. Paid: ai_visibility_estimate with site=${site}, then ai_visibility_run within max_cost_usd.
6. Read: ai_visibility_results (per prompt × model: mentioned, cited, competitors), ai_visibility_sources (top cited domains and URLs), ai_visibility_trend (if earlier runs exist).

Output:
- Mention rate and citation rate per model, and share of voice vs each competitor.
- The prompts where competitors appear and ${site} does not, with the sources the AI cited.
- Five actions: pages to create or improve so they become citable, and third-party sources (from ai_visibility_sources) to earn a mention on.
- Suggest re-running monthly (ai_visibility_run on the saved tracker; schedule it with cron outside the tool).`
  },

  monthly_report: (a, site, now) => {
    const month = a.month?.trim() || lastFullMonth(now)
    if (!/^\d{4}-\d{2}$/.test(month)) throw new WorkflowPromptError('month must be YYYY-MM')
    const ga4 = a.config ? `config=${a.config}` : a.ga4_property ? `property_id=${a.ga4_property}` : null
    return `Write the monthly SEO report for ${site} for ${month}.

1. report_template_list with site=${site}: use the built-in monthly_seo_checkin template's sections and instructions.
2. project_context_get with site=${site}: the current_goal frames the whole report; research_log shows what was bought this month.
3. ${ga4 ? `ga4_organic_overview with ${ga4}, days = the days of ${month} counted back from yesterday, granularity="week": sessions, key events and revenue vs the previous period.` : 'No GA4: say outcomes are not measured and skip GA4 sections.'}
4. gsc_analytics_run with ${gscSource(site, a.config)}, dimensions="query", limit=50, and dimensions="page", limit=50 (note data_through: the last days may be incomplete).
5. ${a.config || ga4 ? `page_opportunities with ${a.config ? `config=${a.config}` : `site=sc-domain:${site}, property_id=${a.ga4_property}`}, days=28: the five pages to work on next.` : 'Skip page_opportunities (needs Search Console + GA4).'}
6. gsc_change_impact with ${gscSource(site, a.config)}${ga4 ? ', from_annotations=true' : ''}: verdicts for changes shipped in the last 60 days.
7. site_audit_status with site=${site} (newest audit; health score and issue counts). If the newest audit is older than 30 days, say so; do not start a crawl inside the report.
8. rank_tracker_get with site=${site} and ai_visibility_trend with site=${site}, if trackers exist (free: they read stored runs; do not start paid runs inside the report).
9. report_save with site=${site}, title "SEO report ${month}", template "monthly_seo_checkin", section_data = the tool outputs above keyed by section heading, intro = a 3-sentence summary: what moved, why, and the one priority for next month.

Output: the summary and the saved report's path. Numbers come only from tool outputs; never estimate missing ones, mark them "not measured".`
  },
}

/** Build a workflow prompt's message text. Throws WorkflowPromptError on bad arguments. */
export function buildWorkflowPrompt(name: string, args: Record<string, string>, now: Date = new Date()): string {
  const def = WORKFLOW_PROMPTS.find((p) => p.name === name)
  if (!def) throw new WorkflowPromptError(`Unknown prompt: ${name}`)
  const missing = def.arguments.filter((x) => x.required && !args[x.name]?.trim()).map((x) => x.name)
  if (missing.length) throw new WorkflowPromptError(`Missing required arguments: ${missing.join(', ')}`)
  const site = args.site
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(site)) throw new WorkflowPromptError(`site must be a domain such as example.com, got "${args.site}"`)
  const trimmed: Record<string, string> = {}
  for (const [k, v] of Object.entries(args)) if (typeof v === 'string' && v.trim()) trimmed[k] = v.trim()
  return BUILDERS[name](trimmed, site, now)
}
