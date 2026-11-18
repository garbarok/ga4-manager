import type { ToolSpec } from './tool-spec.js'

// Tool specs — each tool module assembles and exports its own ToolSpec
// (MCP definition + schema + how it builds args / parses output, or its
// native handler). This module only collects them; see ./tool-spec.ts.
import { ga4SetupSpec } from './tools/ga4-setup.js'
import { ga4ReportSpec } from './tools/ga4-report.js'
import { ga4CleanupSpec } from './tools/ga4-cleanup.js'
import { ga4LinkListSpec, ga4LinkCreateSpec, ga4LinkRemoveSpec } from './tools/ga4-link.js'
import { ga4ValidateSpec } from './tools/ga4-validate.js'
import {
  gscSitemapsListSpec,
  gscSitemapsSubmitSpec,
  gscSitemapsDeleteSpec,
  gscSitemapsGetSpec,
} from './tools/gsc-sitemaps.js'
import { gscInspectUrlSpec } from './tools/gsc-inspect.js'
import { gscAnalyticsRunSpec } from './tools/gsc-analytics.js'
import { gscIndexCoverageSpec } from './tools/gsc-coverage.js'
import { gscCannibalizationSpec } from './tools/gsc-cannibalization.js'
import { gscOpportunitiesSpec } from './tools/gsc-opportunities.js'
import { gscCTRAnomalySpec } from './tools/gsc-ctr-anomaly.js'
import { gscDecaySpec } from './tools/gsc-decay.js'
import { gscUrlHygieneSpec } from './tools/gsc-url-hygiene.js'
import { gscHreflangSpec } from './tools/gsc-hreflang.js'
import { gscHealthSpec } from './tools/gsc-health.js'
import { gscMonitorUrlsSpec } from './tools/gsc-monitor.js'
import { gscTrafficCompareSpec } from './tools/gsc-traffic-compare.js'
import { ga4ConsentHealthSpec } from './tools/ga4-consent-health.js'
import { ga4TrafficReportSpec } from './tools/ga4-traffic-report.js'
import {
  ga4OrganicOverviewSpec,
  ga4OrganicLandingPagesSpec,
  ga4KeyEventsSpec,
  ga4TrafficAcquisitionSpec,
  ga4AudienceSpec,
  ga4SiteSearchSpec,
  ga4EcommerceSpec,
} from './tools/ga4-organic-reports.js'
import { ga4MeasurementHealthSpec } from './tools/ga4-measurement-health.js'
import { ga4AnnotationsSpec } from './tools/ga4-annotations.js'
import { siteGrowthBriefSpec } from './tools/site-growth-brief.js'
import { seoPageAuditSpec } from './tools/seo-page-audit.js'
import { seoAuditBatchSpec } from './tools/seo-audit-batch.js'
import {
  siteAuditRunSpec,
  siteAuditStatusSpec,
  siteAuditIssuesSpec,
  siteAuditPagesSpec,
  siteAuditLighthouseSpec,
  siteAuditListSpec,
  siteAuditDeleteSpec,
} from './tools/site-audit.js'
import { adsenseAccountsListSpec } from './tools/adsense-accounts.js'
import { adsenseReportSpec } from './tools/adsense-report.js'
import { keywordVolumeSpec } from './tools/keyword-volume.js'
import { keywordSerpSnapshotSpec } from './tools/keyword-serp.js'
import { keywordRankCheckSpec } from './tools/keyword-rank-check.js'
import { dataforseoBalanceSpec } from './tools/dataforseo-balance.js'
import { llmMentionsSpec } from './tools/llm-mentions.js'
import { keywordGapSpec } from './tools/keyword-gap.js'
import { rankedKeywordsSpec } from './tools/ranked-keywords.js'
import { keywordIdeasSpec } from './tools/keyword-ideas.js'
import { backlinksOverviewSpec } from './tools/backlinks-overview.js'
import { linkGapSpec } from './tools/link-gap.js'
import { dataforseoRequestSpec } from './tools/dataforseo-request.js'
import { googleTrendsSpec } from './tools/google-trends.js'
import { indexnowSubmitSpec } from './tools/indexnow-submit.js'
import { serverInfoSpec } from './tools/server-info.js'
import { projectContextGetSpec, projectContextUpdateSpec } from './tools/project-context.js'

/** The full tool registry. Order is the tools/list order. */
export const SPECS: ToolSpec[] = [
  // What this install can do and why a group is off (start here)
  serverInfoSpec,
  // Project context: shared agent memory per site (item 4)
  projectContextGetSpec,
  projectContextUpdateSpec,
  // Cross-source entry point: the brief an assistant starts a growth plan from
  siteGrowthBriefSpec,
  // GA4
  ga4SetupSpec,
  ga4ReportSpec,
  ga4CleanupSpec,
  ga4LinkListSpec,
  ga4LinkCreateSpec,
  ga4LinkRemoveSpec,
  ga4ValidateSpec,
  // GSC
  gscSitemapsListSpec,
  gscSitemapsSubmitSpec,
  gscSitemapsDeleteSpec,
  gscSitemapsGetSpec,
  gscInspectUrlSpec,
  gscAnalyticsRunSpec,
  gscIndexCoverageSpec,
  gscCannibalizationSpec,
  gscOpportunitiesSpec,
  gscCTRAnomalySpec,
  gscDecaySpec,
  gscUrlHygieneSpec,
  gscHreflangSpec,
  gscHealthSpec,
  gscMonitorUrlsSpec,
  // Native (no CLI)
  gscTrafficCompareSpec,
  ga4ConsentHealthSpec,
  ga4TrafficReportSpec,
  // GA4 organic reports (item 3)
  ga4OrganicOverviewSpec,
  ga4OrganicLandingPagesSpec,
  ga4KeyEventsSpec,
  ga4TrafficAcquisitionSpec,
  ga4AudienceSpec,
  ga4SiteSearchSpec,
  ga4EcommerceSpec,
  ga4MeasurementHealthSpec,
  ga4AnnotationsSpec,
  seoPageAuditSpec,
  seoAuditBatchSpec,
  // Site crawl audit (item 1): background crawl, site-wide issues, Lighthouse
  siteAuditRunSpec,
  siteAuditStatusSpec,
  siteAuditIssuesSpec,
  siteAuditPagesSpec,
  siteAuditLighthouseSpec,
  siteAuditListSpec,
  siteAuditDeleteSpec,
  // AdSense (publisher reporting — native, no CLI)
  adsenseAccountsListSpec,
  adsenseReportSpec,
  // Keyword research (DataForSEO / ValueSERP)
  keywordVolumeSpec,
  keywordSerpSnapshotSpec,
  keywordRankCheckSpec,
  // Competitive & AI-visibility research (DataForSEO)
  dataforseoBalanceSpec,
  llmMentionsSpec,
  keywordGapSpec,
  rankedKeywordsSpec,
  keywordIdeasSpec,
  googleTrendsSpec,
  backlinksOverviewSpec,
  linkGapSpec,
  // Indexing notification (IndexNow — Bing, Yandex, etc.; native, no CLI)
  indexnowSubmitSpec,
  // Gated raw escape hatch (needs DATAFORSEO_ALLOW_RAW)
  dataforseoRequestSpec,
]

/** Lookup by tool name for dispatch. */
export const SPEC_BY_NAME = new Map(SPECS.map((spec) => [spec.tool.name, spec]))
