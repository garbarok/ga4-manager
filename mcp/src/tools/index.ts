/**
 * GA4 Manager MCP Tools
 *
 * This module exports all MCP tool definitions and handlers.
 */

// GA4 Setup Tool
export {
  ga4SetupInputSchema,
  ga4SetupTool,
  buildSetupArgs,
  parseSetupOutput,
} from './ga4-setup.js';

export type {
  GA4SetupInput,
  GA4Results,
  GSCResults,
  ProjectInfo as SetupProjectInfo,
  SetupOutput,
} from './ga4-setup.js';

// GA4 Report Tool
export {
  ga4ReportInputSchema,
  ga4ReportTool,
  buildReportArgs,
  parseReportOutput,
} from './ga4-report.js';

export type {
  GA4ReportInput,
  ConversionInfo,
  DimensionInfo,
  MetricInfo,
  CalculatedMetricInfo,
  AudienceInfo,
  DataRetentionInfo,
  EnhancedMeasurementInfo,
  ProjectInfo as ReportProjectInfo,
  ReportOutput,
} from './ga4-report.js';

// GA4 Link Tool
export {
  ga4LinkInputSchema,
  ga4LinkTool,
  buildLinkArgs,
  parseLinkOutput,
} from './ga4-link.js';

export type {
  GA4LinkInput,
  BigQueryLinkInfo,
  ChannelGroupInfo,
  SearchConsoleLinkInfo,
  ListLinksOutput,
  LinkOperationResult,
  ProjectInfo as LinkProjectInfo,
  LinkOutput,
} from './ga4-link.js';

// GA4 Validate Tool
export {
  ga4ValidateInputSchema,
  ga4ValidateTool,
  buildValidateArgs,
  parseValidateOutput,
} from './ga4-validate.js';

export type {
  GA4ValidateInput,
  TierLimitsInfo,
  ConfigSummary,
  FileValidationResult,
  ValidateOutput,
} from './ga4-validate.js';

// GA4 Cleanup Tool
export {
  ga4CleanupInputSchema,
  ga4CleanupTool,
  buildCleanupArgs,
  parseCleanupOutput,
} from './ga4-cleanup.js';

export type {
  GA4CleanupInput,
  CleanupItem,
  CleanupTypeResults,
  ProjectInfo as CleanupProjectInfo,
  CleanupOutput,
} from './ga4-cleanup.js';

// GSC Sitemaps Tools (Phase 4)
export {
  gscSitemapsListInputSchema,
  gscSitemapsSubmitInputSchema,
  gscSitemapsDeleteInputSchema,
  gscSitemapsGetInputSchema,
  gscSitemapsListTool,
  gscSitemapsSubmitTool,
  gscSitemapsDeleteTool,
  gscSitemapsGetTool,
  gscSitemapsTools,
  buildSitemapsListArgs,
  buildSitemapsSubmitArgs,
  buildSitemapsDeleteArgs,
  buildSitemapsGetArgs,
  parseSitemapsListOutput,
  parseSitemapsSubmitOutput,
  parseSitemapsDeleteOutput,
  parseSitemapsGetOutput,
} from './gsc-sitemaps.js';

export type {
  GscSitemapsListInput,
  GscSitemapsSubmitInput,
  GscSitemapsDeleteInput,
  GscSitemapsGetInput,
  SitemapInfo,
  SitemapContent,
  SitemapDetails,
  SitemapsListOutput,
  SitemapsSubmitOutput,
  SitemapsDeleteOutput,
  SitemapsGetOutput,
} from './gsc-sitemaps.js';

// GSC URL Inspection Tool (Phase 4)
export {
  gscInspectUrlInputSchema,
  gscInspectUrlTool,
  gscInspectTools,
  buildInspectUrlArgs,
  parseInspectUrlOutput,
} from './gsc-inspect.js';

export type {
  GscInspectUrlInput,
  IndexingIssue as InspectIndexingIssue,
  InspectQuotaStatus,
  InspectUrlOutput,
} from './gsc-inspect.js';

// GSC Monitor URLs Tool (Phase 4)
export {
  gscMonitorUrlsInputSchema,
  gscMonitorUrlsTool,
  gscMonitorTools,
  buildMonitorUrlsArgs,
  parseMonitorUrlsOutput,
} from './gsc-monitor.js';

export type {
  GscMonitorUrlsInput,
  IndexingIssue as MonitorIndexingIssue,
  URLInspectionResult,
  MonitoringSummary,
  QuotaStatus as MonitorQuotaStatus,
  DryRunPreview,
  MonitorUrlsOutput,
} from './gsc-monitor.js';

// GSC Analytics Tool (Phase 4) - MOST IMPORTANT GSC TOOL
export {
  gscAnalyticsRunInputSchema,
  gscAnalyticsRunTool,
  gscAnalyticsTools,
  buildAnalyticsRunArgs,
  parseAnalyticsRunOutput,
  validateDimensions,
  VALID_DIMENSIONS,
  VALID_FORMATS,
} from './gsc-analytics.js';

export type {
  GscAnalyticsRunInput,
  ValidDimension,
  ValidFormat,
  AnalyticsQueryMetadata,
  AnalyticsAggregates,
  AnalyticsRow,
  QuotaStatus as AnalyticsQuotaStatus,
  DryRunQuery,
  AnalyticsRunOutput,
} from './gsc-analytics.js';

// Tool registry - all available tools
export const tools = [
  // Phase 3: GA4 Tools
  // ga4SetupTool, ga4ReportTool, ga4LinkTool, ga4ValidateTool, ga4CleanupTool - imported above

  // Phase 4: GSC Tools
  // gscSitemapsListTool, gscSitemapsSubmitTool, gscSitemapsDeleteTool, gscSitemapsGetTool - imported above
  // gscInspectUrlTool - imported above
] as const;
