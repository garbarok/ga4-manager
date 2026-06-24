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
import { gscHealthSpec } from './tools/gsc-health.js'
import { gscMonitorUrlsSpec } from './tools/gsc-monitor.js'
import { gscTrafficCompareSpec } from './tools/gsc-traffic-compare.js'
import { ga4ConsentHealthSpec } from './tools/ga4-consent-health.js'
import { seoPageAuditSpec } from './tools/seo-page-audit.js'
import { seoAuditBatchSpec } from './tools/seo-audit-batch.js'

/** The full tool registry. Order is the tools/list order. */
export const SPECS: ToolSpec[] = [
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
  gscHealthSpec,
  gscMonitorUrlsSpec,
  // Native (no CLI)
  gscTrafficCompareSpec,
  ga4ConsentHealthSpec,
  seoPageAuditSpec,
  seoAuditBatchSpec,
]

/** Lookup by tool name for dispatch. */
export const SPEC_BY_NAME = new Map(SPECS.map((spec) => [spec.tool.name, spec]))
