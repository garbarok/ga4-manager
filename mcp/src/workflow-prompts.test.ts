import { describe, it, expect } from 'vitest'
import { WORKFLOW_PROMPTS, buildWorkflowPrompt } from './workflow-prompts.js'
import { PROMPTS, getPrompt, PromptError } from './prompts.js'
import { SPEC_BY_NAME } from './registry.js'

const ARGS: Record<string, Record<string, string>> = {
  project_setup: { site: 'example.com', config: 'configs/site.yaml', competitors: 'rival.example, other.example' },
  seo_audit: { site: 'example.com' },
  keyword_research: { site: 'example.com', seeds: 'web analytics, privacy analytics' },
  keyword_clustering: { site: 'example.com', tag: 'research-2026-11' },
  competitor_analysis: { site: 'example.com', competitor: 'rival.example' },
  competitive_landscape: { site: 'example.com' },
  ai_visibility_audit: { site: 'example.com', topics: 'web analytics' },
  monthly_report: { site: 'example.com', config: 'configs/site.yaml', month: '2026-10' },
}

/** snake_case words that look like tool names (contain an underscore and match a known prefix). */
function toolMentions(text: string): string[] {
  const prefixes = ['gsc_', 'ga4_', 'site_audit_', 'rank_tracker_', 'ai_visibility_', 'keyword', 'keywords_', 'project_context_', 'report_', 'serp_', 'domain_', 'backlinks_', 'link_', 'ranked_', 'dataforseo_', 'page_opportunities', 'seo_', 'llm_']
  return [...new Set(text.match(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g) ?? [])].filter((w) => prefixes.some((p) => w.startsWith(p)))
}

const NOT_TOOLS = new Set(['keyword_set', 'ga4_property', 'max_cost_usd', 'estimate_only', 'refresh_cache', 'site_audit', 'gsc_source', 'project_context', 'page_opportunities_input', 'report_template', 'keywords_list_tag', 'link_gap_input', 'serp_overlap', 'domain_property', 'seo_audit', 'ai_visibility_audit', 'keyword_research', 'keyword_clustering', 'competitor_analysis', 'competitive_landscape', 'monthly_report', 'project_setup', 'monthly_seo_checkin', 'section_data', 'location_name', 'language_code', 'pages_per_issue', 'max_pages', 'lighthouse_pages', 'start_url', 'include_pages', 'pages_limit', 'replace_tags', 'brand_terms', 'from_annotations', 'recent_lookups', 'current_goal', 'business_overview', 'writing_preferences', 'key_pages', 'brand_name', 'research_log', 'data_through', 'tool_input'])

describe('workflow prompts', () => {
  it('ships the eight OpenSEO-style workflows and lists them in prompts/list', () => {
    expect(WORKFLOW_PROMPTS.map((p) => p.name)).toEqual([
      'project_setup', 'seo_audit', 'keyword_research', 'keyword_clustering', 'competitor_analysis', 'competitive_landscape', 'ai_visibility_audit', 'monthly_report',
    ])
    for (const p of WORKFLOW_PROMPTS) expect(PROMPTS).toContainEqual(p)
  })

  it('every tool a workflow names is registered', () => {
    for (const p of WORKFLOW_PROMPTS) {
      const text = buildWorkflowPrompt(p.name, ARGS[p.name], new Date('2026-11-18T00:00:00Z'))
      for (const t of toolMentions(text).filter((w) => !NOT_TOOLS.has(w))) {
        expect(SPEC_BY_NAME.has(t), `${p.name} mentions unknown tool ${t}`).toBe(true)
      }
    }
  })

  it('paid workflows carry the spending rules; free ones say they are free', () => {
    for (const name of ['keyword_research', 'keyword_clustering', 'competitor_analysis', 'competitive_landscape', 'ai_visibility_audit']) {
      const text = buildWorkflowPrompt(name, ARGS[name])
      expect(text, name).toContain('estimate_only: true')
      expect(text, name).toContain('research.recent_lookups')
      expect(text, name).toContain('dataforseo_balance')
    }
    expect(buildWorkflowPrompt('seo_audit', ARGS.seo_audit)).toMatch(/Free/)
    expect(buildWorkflowPrompt('project_setup', ARGS.project_setup)).toContain('"rival.example", "other.example"')
  })

  it('validates arguments through getPrompt', () => {
    expect(() => getPrompt('competitor_analysis', { site: 'example.com' })).toThrow(PromptError)
    expect(() => getPrompt('seo_audit', { site: 'not a domain' })).toThrow(/domain/)
    expect(() => getPrompt('monthly_report', { site: 'example.com', month: 'October' })).toThrow(/YYYY-MM/)
    const r = getPrompt('seo_audit', { site: 'https://www.Example.com/' })
    expect(r.messages[0].content.text).toContain('start_url=https://example.com/')
  })

  it('monthly_report defaults to the last full month', () => {
    expect(buildWorkflowPrompt('monthly_report', { site: 'example.com' }, new Date('2026-03-05T00:00:00Z'))).toContain('for 2026-02')
  })
})

describe('built-in report templates', () => {
  it('only reference registered tools', async () => {
    const mod = await import('./reports/templates.js')
    const builtins = Object.values(mod).find((v) => Array.isArray(v) && v.some((t: { sections?: unknown }) => t?.sections)) as { sections: { tool?: string }[] }[]
    expect(builtins?.length).toBeGreaterThan(0)
    for (const t of builtins) for (const s of t.sections) if (s.tool) expect(SPEC_BY_NAME.has(s.tool), s.tool).toBe(true)
  })
})
