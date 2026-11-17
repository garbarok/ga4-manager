/**
 * Tool groups: which credentials each part of the server needs. server_info
 * reports, per group, whether it is enabled and why not, so an agent can tell
 * "this install is old" from "this install is missing DATAFORSEO_*".
 *
 * Every registered tool must belong to exactly one group (registry.test.ts).
 */

export type GroupId =
  | 'meta'
  | 'ga4_admin'
  | 'ga4_data'
  | 'search_console'
  | 'cross_source'
  | 'adsense'
  | 'seo_audit'
  | 'dataforseo'
  | 'valueserp'
  | 'indexnow'
  | 'local_state'
  | 'raw_escape_hatch'

export type Requirement =
  | { kind: 'google'; scope: string }
  | { kind: 'env'; vars: string[]; hint: string }
  | { kind: 'optional_env'; vars: string[]; effect: string }
  | { kind: 'flag'; var: string; hint: string }

export interface GroupDef {
  id: GroupId
  title: string
  requirements: Requirement[]
  tools: string[]
}

export const SCOPES = {
  analyticsReadonly: 'https://www.googleapis.com/auth/analytics.readonly',
  analyticsEdit: 'https://www.googleapis.com/auth/analytics.edit',
  webmasters: 'https://www.googleapis.com/auth/webmasters',
  webmastersReadonly: 'https://www.googleapis.com/auth/webmasters.readonly',
  adsenseReadonly: 'https://www.googleapis.com/auth/adsense.readonly',
} as const

const DATAFORSEO: Requirement = {
  kind: 'env',
  vars: ['DATAFORSEO_USERNAME', 'DATAFORSEO_PASSWORD'],
  hint: 'Set DATAFORSEO_USERNAME and DATAFORSEO_PASSWORD (DataForSEO dashboard → API Access). See mcp/PERMISSIONS.md#dataforseo.',
}

export const GROUPS: GroupDef[] = [
  { id: 'meta', title: 'Server info', requirements: [], tools: ['server_info'] },
  {
    id: 'ga4_admin',
    title: 'GA4 Admin (setup, cleanup, links, validation)',
    requirements: [{ kind: 'google', scope: SCOPES.analyticsEdit }],
    tools: ['ga4_setup', 'ga4_report', 'ga4_cleanup', 'ga4_link_list', 'ga4_link_create', 'ga4_link_remove', 'ga4_validate', 'ga4_annotations'],
  },
  {
    id: 'ga4_data',
    title: 'GA4 Data API reports',
    requirements: [{ kind: 'google', scope: SCOPES.analyticsReadonly }],
    tools: [
      'ga4_consent_health', 'ga4_traffic_report',
      'ga4_organic_overview', 'ga4_organic_landing_pages', 'ga4_key_events', 'ga4_traffic_acquisition',
      'ga4_audience', 'ga4_site_search', 'ga4_ecommerce', 'ga4_measurement_health',
    ],
  },
  {
    id: 'search_console',
    title: 'Search Console',
    requirements: [{ kind: 'google', scope: SCOPES.webmastersReadonly }],
    tools: [
      'gsc_sitemaps_list', 'gsc_sitemaps_submit', 'gsc_sitemaps_delete', 'gsc_sitemaps_get', 'gsc_inspect_url',
      'gsc_analytics_run', 'gsc_index_coverage', 'gsc_cannibalization', 'gsc_opportunities', 'gsc_ctr_anomaly',
      'gsc_decay', 'gsc_url_hygiene', 'gsc_hreflang', 'gsc_health', 'gsc_monitor_urls', 'gsc_traffic_compare',
      'gsc_change_impact',
    ],
  },
  {
    id: 'cross_source',
    title: 'Search Console × GA4',
    requirements: [
      { kind: 'google', scope: SCOPES.webmastersReadonly },
      { kind: 'google', scope: SCOPES.analyticsReadonly },
    ],
    tools: ['site_growth_brief', 'page_opportunities'],
  },
  {
    id: 'adsense',
    title: 'AdSense reporting',
    requirements: [{ kind: 'google', scope: SCOPES.adsenseReadonly }],
    tools: ['adsense_accounts_list', 'adsense_report'],
  },
  {
    id: 'seo_audit',
    title: 'On-page and site crawl audits',
    requirements: [
      { kind: 'optional_env', vars: ['PSI_API_KEY'], effect: 'Lighthouse and Core Web Vitals use the shared, low PageSpeed quota without it.' },
      { kind: 'optional_env', vars: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'], effect: 'JS rendering (render_js) is unavailable without Cloudflare Browser Rendering.' },
    ],
    tools: [
      'seo_page_audit', 'seo_audit_batch',
      'site_audit_run', 'site_audit_status', 'site_audit_issues', 'site_audit_pages', 'site_audit_lighthouse',
      'site_audit_list', 'site_audit_delete',
    ],
  },
  {
    id: 'dataforseo',
    title: 'DataForSEO research (paid)',
    requirements: [DATAFORSEO],
    tools: [
      'dataforseo_balance', 'keyword_volume', 'keyword_serp_snapshot', 'llm_mentions', 'keyword_gap', 'ranked_keywords',
      'keyword_ideas', 'google_trends', 'backlinks_overview', 'link_gap',
      'rank_tracker_run', 'rank_tracker_estimate',
      'ai_visibility_research', 'ai_visibility_explore', 'ai_visibility_run', 'ai_visibility_estimate',
      'serp_competitors', 'domain_overview', 'serp_locations', 'keyword_suggestions',
    ],
  },
  {
    id: 'valueserp',
    title: 'ValueSERP live rank check (paid)',
    requirements: [{ kind: 'env', vars: ['VALUESERP_API_KEY'], hint: 'Set VALUESERP_API_KEY (valueserp.com dashboard).' }],
    tools: ['keyword_rank_check'],
  },
  {
    id: 'indexnow',
    title: 'IndexNow submission',
    requirements: [{ kind: 'optional_env', vars: ['INDEXNOW_KEY'], effect: 'Each call must pass `key` without it.' }],
    tools: ['indexnow_submit'],
  },
  {
    id: 'local_state',
    title: 'Local project state (context, saved keywords, trackers, reports)',
    requirements: [],
    tools: [
      'project_context_get', 'project_context_update',
      'rank_tracker_create', 'rank_tracker_update', 'rank_tracker_get', 'rank_tracker_history', 'rank_tracker_list', 'rank_tracker_delete',
      'ai_visibility_prompts_generate', 'ai_visibility_tracker_save', 'ai_visibility_results', 'ai_visibility_trend',
      'ai_visibility_sources', 'ai_visibility_answer', 'ai_visibility_export',
      'keywords_save', 'keywords_list', 'keywords_remove',
      'report_save', 'report_list', 'report_get', 'report_delete', 'report_template_save', 'report_template_list', 'report_template_delete',
    ],
  },
  {
    id: 'raw_escape_hatch',
    title: 'Raw DataForSEO request',
    requirements: [DATAFORSEO, { kind: 'flag', var: 'DATAFORSEO_ALLOW_RAW', hint: 'Set DATAFORSEO_ALLOW_RAW=1 to enable the raw request tool.' }],
    tools: ['dataforseo_request'],
  },
]

export const GROUP_BY_TOOL = new Map<string, GroupId>(GROUPS.flatMap((g) => g.tools.map((t) => [t, g.id] as const)))
