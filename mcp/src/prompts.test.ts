import { describe, it, expect } from 'vitest'
import { PROMPTS, getPrompt, PromptError } from './prompts.js'
import { SPEC_BY_NAME } from './registry.js'

const FULL = {
  site: 'sc-domain:example.com',
  config: 'configs/example.yaml',
  ga4_property: '123456',
  adsense_account: 'accounts/pub-1',
  rollout_start: '2026-03-01',
  rollout_end: '2026-03-15',
}

const textOf = (name: string, args: Record<string, string> = FULL) =>
  getPrompt(name, args).messages[0].content.text

describe('prompts', () => {
  it('lists the three prompts with required arguments', () => {
    expect(PROMPTS.map((p) => p.name)).toEqual(['daily_briefing', 'weekly_review', 'core_update_check'])
    for (const p of PROMPTS) expect(p.arguments.find((a) => a.name === 'site')?.required).toBe(true)
    const core = PROMPTS.find((p) => p.name === 'core_update_check')!
    expect(core.arguments.filter((a) => a.required).map((a) => a.name)).toEqual([
      'site',
      'config',
      'rollout_start',
      'rollout_end',
    ])
  })

  it('returns a single user text message', () => {
    for (const p of PROMPTS) {
      const r = getPrompt(p.name, FULL)
      expect(r.messages).toHaveLength(1)
      expect(r.messages[0].role).toBe('user')
      expect(r.messages[0].content.text).toContain(FULL.site)
    }
  })

  it('rejects unknown prompts and missing or invalid arguments', () => {
    expect(() => getPrompt('nope', FULL)).toThrow(PromptError)
    expect(() => getPrompt('daily_briefing', {})).toThrow(/site, config/)
    expect(() => getPrompt('daily_briefing', { site: 'x' })).toThrow(/config/)
    expect(() => getPrompt('core_update_check', { site: 'x' })).toThrow(/config, rollout_start, rollout_end/)
    expect(() => getPrompt('core_update_check', { ...FULL, rollout_end: '15/03/2026' })).toThrow(/YYYY-MM-DD/)
    expect(() => getPrompt('core_update_check', { ...FULL, rollout_end: '2026-02-01' })).toThrow(/before/)
  })

  it('skips GA4 and AdSense steps when their arguments are omitted', () => {
    const t = textOf('daily_briefing', { site: FULL.site, config: FULL.config })
    expect(t).toContain('gsc_health')
    expect(t).not.toContain('ga4_traffic_report')
    expect(t).not.toContain('adsense_report')
    expect(textOf('daily_briefing')).toContain('adsense_report')
  })

  it('states the alert thresholds and a single decision in the weekly review', () => {
    const t = textOf('weekly_review')
    expect(t).toContain('30%')
    expect(t).toContain('50 clicks')
    expect(t).toContain('1000 impressions')
    expect(t).toContain('exactly ONE decision')
    expect(t).toContain('ga4_annotations')
  })

  it('core_update_check embeds dates and the three verdicts', () => {
    const t = textOf('core_update_check')
    expect(t).toContain('2026-03-01')
    expect(t).toContain('2026-03-15')
    for (const v of ['no-action', 'review', 'act']) expect(t).toContain(v)
  })

  it('only mentions tools that exist in the registry', () => {
    const optional = new Set<string>()
    for (const p of PROMPTS) {
      const tokens = textOf(p.name).match(/\b(?:gsc|ga4|adsense|seo|keyword|site)_[a-z0-9_]+\b/g) ?? []
      expect(tokens.length).toBeGreaterThan(0)
      for (const tok of tokens) {
        if (optional.has(tok)) continue
        expect(SPEC_BY_NAME.has(tok), `${p.name} mentions unknown tool ${tok}`).toBe(true)
      }
    }
  })

  it('passes the config path to the config-based tools', () => {
    for (const p of PROMPTS) expect(textOf(p.name)).toContain('config=configs/example.yaml')
    expect(textOf('weekly_review')).toContain('gsc_ctr_anomaly with config=configs/example.yaml')
  })

  it('names the compare periods so period_a is the older baseline', () => {
    const w = textOf('weekly_review')
    expect(w).toContain('period_a (baseline)')
    expect(w).toContain('period_b (current)')
    expect(w).toContain('NEGATIVE clicks_delta')
    const c = textOf('core_update_check')
    expect(c).toContain('period_a={start:"2026-02-22",end:"2026-02-28"}')
    expect(c).toContain('period_b={start:"2026-03-16",end:"2026-03-22"}')
  })

  it('core_update_check waits until 10 days after the rollout ends', () => {
    expect(textOf('core_update_check')).toContain('If today is before 2026-03-25, stop and answer: wait until 2026-03-25')
  })

  it('asks GA4 for per-date rows and AdSense for complete days', () => {
    for (const n of ['daily_briefing', 'weekly_review', 'core_update_check']) {
      expect(textOf(n)).toContain('dimensions=["date"')
    }
    expect(textOf('core_update_check')).toContain('Organic Search')
    expect(textOf('daily_briefing')).toContain('same weekday one week earlier')
    expect(textOf('daily_briefing')).not.toContain('today is partial')
  })
})
