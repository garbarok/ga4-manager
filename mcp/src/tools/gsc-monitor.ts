import { z } from 'zod';

// ============================================================================
// GSC Monitor URLs Tool
// ============================================================================

/**
 * Input schema for gsc_monitor_urls tool
 * Supports two modes:
 * 1. Config-based: { config: string, dry_run?: boolean, format?: string }
 * 2. Direct URL array (NEW in v2.0.0): { site: string, urls: string[], dry_run?: boolean, format?: string }
 */
export const gscMonitorUrlsInputSchema = z.union([
  // Existing config-based approach
  z.object({
    /** Path to configuration file with URLs to monitor */
    config: z.string().min(1, 'Config file path is required'),
    /** Preview without making API calls */
    dry_run: z.boolean().optional().default(false),
    /** Output format: json, table, or markdown */
    format: z.string().optional().default('json'),
  }),
  // NEW: Direct URL array approach (v2.0.0)
  z.object({
    /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
    site: z.string().min(1, 'Site URL is required'),
    /** URLs to monitor (max 50) */
    urls: z.array(z.string().url()).min(1, 'At least one URL required').max(50, 'Maximum 50 URLs allowed'),
    /** Preview without making API calls */
    dry_run: z.boolean().optional().default(false),
    /** Output format: json, table, or markdown */
    format: z.string().optional().default('json'),
  }),
]);

/** Input type for gsc_monitor_urls (with optional fields) */
export type GscMonitorUrlsInput = z.input<typeof gscMonitorUrlsInputSchema>;

/**
 * Indexing issue details
 */
export interface IndexingIssue {
  severity: 'ERROR' | 'WARNING';
  message: string;
  issue_type: string;
}

/**
 * URL inspection result from monitoring
 */
export interface URLInspectionResult {
  url: string;
  index_status: 'PASS' | 'FAIL' | 'PARTIAL' | 'NEUTRAL' | string;
  coverage_state: string;
  last_crawl_time?: string;
  google_canonical?: string;
  user_canonical?: string;
  robots_blocked: boolean;
  indexing_allowed: boolean;
  mobile_usable: boolean;
  mobile_issues: string[];
  rich_results_status?: string;
  rich_results_issues: string[];
  indexing_issues: IndexingIssue[];
}

/**
 * Summary statistics for monitoring results
 */
export interface MonitoringSummary {
  total_urls: number;
  indexed: number;
  not_indexed: number;
  partial: number;
  total_issues: number;
  urls_with_issues: number;
  mobile_issues_count: number;
}

/**
 * Quota status from GSC API
 */
export interface QuotaStatus {
  used: number;
  limit: number;
  date: string;
  percentage: number;
  status: 'healthy' | 'warning' | 'critical';
  remaining: number;
}

/**
 * Dry-run preview output
 */
export interface DryRunPreview {
  site: string;
  urls_to_inspect: string[];
  url_count: number;
  estimated_quota_usage: number;
}

/**
 * Monitor URLs output structure
 */
export interface MonitorUrlsOutput {
  success: boolean;
  operation: 'monitor';
  site?: string;
  dry_run: boolean;
  format: string;
  preview?: DryRunPreview;
  results?: URLInspectionResult[];
  summary?: MonitoringSummary;
  quota?: QuotaStatus;
  error?: string;
}

/**
 * Build CLI arguments for monitor URLs
 * Only works for config-based input (not URL array mode)
 */
export function buildMonitorUrlsArgs(input: GscMonitorUrlsInput): string[] {
  // Type guard: only config-based input can use CLI
  if (!('config' in input)) {
    throw new Error('buildMonitorUrlsArgs() requires config-based input');
  }

  const args = ['gsc', 'monitor', 'run', '--config', input.config];

  if (input.dry_run) {
    args.push('--dry-run');
  }

  if (input.format && input.format !== 'table') {
    args.push('--format', input.format);
  }

  return args;
}

/**
 * Parse dry-run preview output
 */
function parseDryRunOutput(output: string): DryRunPreview | null {
  const preview: DryRunPreview = {
    site: '',
    urls_to_inspect: [],
    url_count: 0,
    estimated_quota_usage: 0,
  };

  // Extract site
  const siteMatch = output.match(/Site:\s*(.+)/);
  if (siteMatch) {
    preview.site = siteMatch[1].trim();
  }

  // Extract URL count
  const urlCountMatch = output.match(/URLs to inspect:\s*(\d+)/);
  if (urlCountMatch) {
    preview.url_count = parseInt(urlCountMatch[1], 10);
    preview.estimated_quota_usage = preview.url_count;
  }

  // Parse table rows for URLs
  // Table format: | # | URL |
  const tableRowRegex = /\|\s*\d+\s*\|\s*(https?:\/\/[^\s|]+)\s*\|/g;
  let match;
  while ((match = tableRowRegex.exec(output)) !== null) {
    preview.urls_to_inspect.push(match[1].trim());
  }

  if (preview.urls_to_inspect.length > 0) {
    preview.url_count = preview.urls_to_inspect.length;
    preview.estimated_quota_usage = preview.url_count;
  }

  return preview.site || preview.urls_to_inspect.length > 0 ? preview : null;
}

/**
 * Parse JSON output format
 */
function parseJSONOutput(output: string): URLInspectionResult[] {
  // Find the start of JSON array
  const startIndex = output.indexOf('[');
  if (startIndex === -1) {
    return [];
  }

  // Find matching closing bracket by counting brackets
  let bracketCount = 0;
  let endIndex = -1;
  for (let i = startIndex; i < output.length; i++) {
    if (output[i] === '[') bracketCount++;
    if (output[i] === ']') bracketCount--;
    if (bracketCount === 0) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return [];
  }

  const jsonStr = output.substring(startIndex, endIndex + 1);

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.map(transformResult);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Transform raw API result to our interface
 */
function transformResult(raw: Record<string, unknown>): URLInspectionResult {
  return {
    url: (raw.URL as string) || (raw.url as string) || '',
    index_status: (raw.IndexStatus as string) || (raw.index_status as string) || '',
    coverage_state: (raw.CoverageState as string) || (raw.coverage_state as string) || '',
    last_crawl_time: (raw.LastCrawlTime as string) || (raw.last_crawl_time as string) || undefined,
    google_canonical: (raw.GoogleCanonical as string) || (raw.google_canonical as string) || undefined,
    user_canonical: (raw.UserCanonical as string) || (raw.user_canonical as string) || undefined,
    robots_blocked: Boolean(raw.RobotsBlocked ?? raw.robots_blocked),
    indexing_allowed: Boolean(raw.IndexingAllowed ?? raw.indexing_allowed ?? true),
    mobile_usable: Boolean(raw.MobileUsable ?? raw.mobile_usable ?? true),
    mobile_issues: (raw.MobileIssues as string[]) || (raw.mobile_issues as string[]) || [],
    rich_results_status: (raw.RichResultsStatus as string) || (raw.rich_results_status as string) || undefined,
    rich_results_issues: (raw.RichResultsIssues as string[]) || (raw.rich_results_issues as string[]) || [],
    indexing_issues: transformIndexingIssues(
      (raw.IndexingIssues as Record<string, unknown>[]) ||
      (raw.indexing_issues as Record<string, unknown>[]) ||
      []
    ),
  };
}

/**
 * Transform indexing issues from raw format
 */
function transformIndexingIssues(raw: Record<string, unknown>[]): IndexingIssue[] {
  return raw.map((issue) => ({
    severity: ((issue.Severity as string) || (issue.severity as string) || 'WARNING') as 'ERROR' | 'WARNING',
    message: (issue.Message as string) || (issue.message as string) || '',
    issue_type: (issue.IssueType as string) || (issue.issue_type as string) || '',
  }));
}

/**
 * Parse table output format
 */
function parseTableOutput(output: string): URLInspectionResult[] {
  const results: URLInspectionResult[] = [];

  // Parse table rows
  // Table format: | URL | Index Status | Coverage | Mobile | Issues |
  const tableRowRegex = /\|\s*(https?:\/\/[^\s|]+(?:\.{3})?)\s*\|\s*([\u2713\u2717\u26a0]?\s*\w+(?:\s+\w+)?)\s*\|\s*(\w+(?:_\w+)*)\s*\|\s*([\u2713\u2717\u26a0]?\s*\w+(?:\s*\(\d+\))?)\s*\|\s*(\d+)\s*\|/g;

  let match;
  while ((match = tableRowRegex.exec(output)) !== null) {
    const url = match[1].trim();
    const indexStatusRaw = match[2].trim();
    const coverageState = match[3].trim();
    const mobileRaw = match[4].trim();
    const issuesCount = parseInt(match[5], 10);

    // Parse index status
    let indexStatus = 'NEUTRAL';
    if (indexStatusRaw.includes('INDEXED') || indexStatusRaw.includes('PASS')) {
      indexStatus = 'PASS';
    } else if (indexStatusRaw.includes('NOT INDEXED') || indexStatusRaw.includes('FAIL')) {
      indexStatus = 'FAIL';
    } else if (indexStatusRaw.includes('PARTIAL')) {
      indexStatus = 'PARTIAL';
    }

    // Parse mobile usability
    const mobileUsable = mobileRaw.includes('Usable') || mobileRaw.includes('\u2713');
    const mobileIssuesMatch = mobileRaw.match(/\((\d+)\)/);
    const mobileIssuesCount = mobileIssuesMatch ? parseInt(mobileIssuesMatch[1], 10) : 0;

    const result: URLInspectionResult = {
      url: url.replace(/\.{3}$/, ''), // Remove truncation dots
      index_status: indexStatus,
      coverage_state: coverageState,
      robots_blocked: false,
      indexing_allowed: indexStatus !== 'FAIL',
      mobile_usable: mobileUsable,
      mobile_issues: mobileIssuesCount > 0 ? Array.from({ length: mobileIssuesCount }, () => 'Mobile issue detected') : [],
      rich_results_issues: [],
      indexing_issues: issuesCount > 0 ? Array.from({ length: issuesCount }, () => ({
        severity: 'WARNING' as const,
        message: 'Issue detected',
        issue_type: 'UNKNOWN',
      })) : [],
    };

    results.push(result);
  }

  return results;
}

/**
 * Calculate summary statistics from results
 */
function calculateSummary(results: URLInspectionResult[]): MonitoringSummary {
  const summary: MonitoringSummary = {
    total_urls: results.length,
    indexed: 0,
    not_indexed: 0,
    partial: 0,
    total_issues: 0,
    urls_with_issues: 0,
    mobile_issues_count: 0,
  };

  for (const result of results) {
    switch (result.index_status) {
      case 'PASS':
        summary.indexed++;
        break;
      case 'FAIL':
        summary.not_indexed++;
        break;
      case 'PARTIAL':
        summary.partial++;
        break;
    }

    const issueCount = result.indexing_issues.length;
    summary.total_issues += issueCount;
    if (issueCount > 0) {
      summary.urls_with_issues++;
    }

    summary.mobile_issues_count += result.mobile_issues.length;
  }

  return summary;
}

/**
 * Parse quota status from output
 */
function parseQuotaStatus(output: string): QuotaStatus | null {
  const quota: QuotaStatus = {
    used: 0,
    limit: 2000,
    date: '',
    percentage: 0,
    status: 'healthy',
    remaining: 2000,
  };

  // Extract date
  const dateMatch = output.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    quota.date = dateMatch[1];
  }

  // Extract used/limit
  const usageMatch = output.match(/Inspections Used:\s*(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)%\)/);
  if (usageMatch) {
    quota.used = parseInt(usageMatch[1], 10);
    quota.limit = parseInt(usageMatch[2], 10);
    quota.percentage = parseFloat(usageMatch[3]);
    quota.remaining = quota.limit - quota.used;

    // Determine status
    if (quota.percentage >= 95) {
      quota.status = 'critical';
    } else if (quota.percentage >= 75) {
      quota.status = 'warning';
    } else {
      quota.status = 'healthy';
    }

    return quota;
  }

  // Try alternative format: Remaining: N
  const remainingMatch = output.match(/Remaining:\s*(\d+)/);
  if (remainingMatch) {
    quota.remaining = parseInt(remainingMatch[1], 10);
    quota.used = quota.limit - quota.remaining;
    quota.percentage = (quota.used / quota.limit) * 100;

    if (quota.percentage >= 95) {
      quota.status = 'critical';
    } else if (quota.percentage >= 75) {
      quota.status = 'warning';
    } else {
      quota.status = 'healthy';
    }

    return quota;
  }

  return null;
}

/**
 * Process URL array mode by inspecting each URL individually
 * This is the internal handler for v2.0.0 direct URL array feature
 */
export async function processUrlArrayMode(
  input: { site: string; urls: string[]; dry_run?: boolean; format?: string },
  executeInspect: (site: string, url: string) => Promise<{ stdout: string; exitCode: number }>
): Promise<MonitorUrlsOutput> {
  const result: MonitorUrlsOutput = {
    success: true,
    operation: 'monitor',
    site: input.site,
    dry_run: input.dry_run || false,
    format: input.format || 'json',
  };

  // Handle dry-run mode
  if (input.dry_run) {
    result.preview = {
      site: input.site,
      urls_to_inspect: input.urls,
      url_count: input.urls.length,
      estimated_quota_usage: input.urls.length,
    };
    return result;
  }

  // Inspect each URL
  const results: URLInspectionResult[] = [];
  for (const url of input.urls) {
    try {
      const inspectResult = await executeInspect(input.site, url);

      if (inspectResult.exitCode !== 0) {
        // If any URL fails, return error
        result.success = false;
        result.error = `Failed to inspect URL: ${url}`;
        return result;
      }

      // Parse the inspection output using gsc-inspect parser
      // We'll need to import this dynamically to avoid circular dependency
      const { parseInspectUrlOutput } = await import('./gsc-inspect.js');
      const inspectOutput = parseInspectUrlOutput(inspectResult.stdout);

      if (!inspectOutput.success) {
        result.success = false;
        result.error = inspectOutput.error || `Failed to inspect URL: ${url}`;
        return result;
      }

      // Transform to URLInspectionResult format
      results.push({
        url: inspectOutput.url || url,
        index_status: inspectOutput.verdict || 'NEUTRAL',
        coverage_state: inspectOutput.coverage_state || '',
        last_crawl_time: inspectOutput.last_crawl,
        google_canonical: inspectOutput.google_canonical,
        user_canonical: inspectOutput.user_canonical,
        robots_blocked: inspectOutput.robots_blocked || false,
        indexing_allowed: inspectOutput.indexing_allowed !== false,
        mobile_usable: inspectOutput.mobile_usability === 'PASS',
        mobile_issues: inspectOutput.mobile_issues?.map(issue =>
          `${issue.severity}: ${issue.message}`
        ) || [],
        rich_results_status: inspectOutput.rich_results_status,
        rich_results_issues: inspectOutput.rich_results_issues || [],
        indexing_issues: inspectOutput.issues.map(issue => ({
          severity: issue.severity,
          message: issue.message,
          issue_type: issue.issue_type,
        })),
      });
    } catch (error) {
      result.success = false;
      result.error = `Error inspecting URL ${url}: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }

  result.results = results;
  result.summary = calculateSummary(results);

  return result;
}

/**
 * Parse CLI output for monitor URLs
 */
export function parseMonitorUrlsOutput(output: string, input: GscMonitorUrlsInput): MonitorUrlsOutput {
  const result: MonitorUrlsOutput = {
    success: true,
    operation: 'monitor',
    dry_run: input.dry_run || false,
    format: input.format || 'json',
  };

  // Check for errors
  if (output.includes('Failed to load config:')) {
    const errorMatch = output.match(/Failed to load config:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to load config';
    return result;
  }

  if (output.includes('missing search_console config')) {
    result.success = false;
    result.error = 'Missing search_console configuration in config file';
    return result;
  }

  if (output.includes('No url_inspection configuration found')) {
    result.success = false;
    result.error = 'No url_inspection configuration found in config file';
    return result;
  }

  if (output.includes('No priority URLs configured')) {
    result.success = false;
    result.error = 'No priority URLs configured in url_inspection.priority_urls';
    return result;
  }

  if (output.includes('Failed to create GSC client:')) {
    const errorMatch = output.match(/Failed to create GSC client:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to create GSC client';
    return result;
  }

  if (output.includes('Failed to inspect URLs:')) {
    const errorMatch = output.match(/Failed to inspect URLs:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to inspect URLs';
    return result;
  }

  if (output.includes('daily quota critical threshold reached')) {
    const errorMatch = output.match(/daily quota critical threshold reached:\s*(.+)/);
    result.success = false;
    result.error = errorMatch
      ? `Quota exceeded: ${errorMatch[1].trim()}`
      : 'Daily quota limit reached';
    return result;
  }

  // Extract site URL - be careful to not capture trailing ellipsis
  // Domain properties: sc-domain:example.com
  // URL prefixes: https://example.com/
  const siteMatch = output.match(/(?:Site|for)\s*[:]?\s*(sc-domain:[a-zA-Z0-9.-]+|https?:\/\/[a-zA-Z0-9.-]+\/?)/);
  if (siteMatch) {
    // Clean up any trailing dots/ellipsis from the site URL
    result.site = siteMatch[1].trim().replace(/\.{2,}$/, '');
  }

  // Handle dry-run mode
  if (input.dry_run || output.includes('Dry-Run Mode')) {
    result.dry_run = true;
    const preview = parseDryRunOutput(output);
    if (preview) {
      result.preview = preview;
      if (!result.site && preview.site) {
        result.site = preview.site;
      }
    }
    return result;
  }

  // Parse results based on format
  let results: URLInspectionResult[] = [];

  if (input.format === 'json') {
    results = parseJSONOutput(output);
  } else {
    // Try to parse table format
    results = parseTableOutput(output);

    // If table parsing didn't work, try JSON fallback
    if (results.length === 0) {
      results = parseJSONOutput(output);
    }
  }

  // Always set results (even if empty) and calculate summary
  result.results = results;
  result.summary = calculateSummary(results);

  // Parse quota status
  const quota = parseQuotaStatus(output);
  if (quota) {
    result.quota = quota;
  }

  return result;
}

/**
 * MCP Tool definition for gsc_monitor_urls
 */
export const gscMonitorUrlsTool = {
  name: 'gsc_monitor_urls',
  description: 'Monitor multiple URLs for indexing issues. Supports two modes: 1) Config-based: Load URLs from YAML file, 2) Direct array (NEW v2.0.0): Pass URLs directly as array (max 50 URLs). Returns inspection results with index status, mobile usability, and any issues detected.',
  inputSchema: {
    type: 'object',
    oneOf: [
      {
        type: 'object',
        properties: {
          config: {
            type: 'string',
            description: 'Path to configuration file with URLs to monitor (YAML format with search_console.url_inspection.priority_urls)',
          },
          dry_run: {
            type: 'boolean',
            description: 'Preview URLs without making API calls (recommended first step)',
            default: false,
          },
          format: {
            type: 'string',
            enum: ['json', 'table', 'markdown'],
            description: 'Output format for results',
            default: 'json',
          },
        },
        required: ['config'],
      },
      {
        type: 'object',
        properties: {
          site: {
            type: 'string',
            description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)',
          },
          urls: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            minItems: 1,
            maxItems: 50,
            description: 'URLs to monitor (max 50 URLs)',
          },
          dry_run: {
            type: 'boolean',
            description: 'Preview URLs without making API calls',
            default: false,
          },
          format: {
            type: 'string',
            enum: ['json', 'table', 'markdown'],
            description: 'Output format for results',
            default: 'json',
          },
        },
        required: ['site', 'urls'],
      },
    ],
  },
};

// ============================================================================
// Exports
// ============================================================================

export const gscMonitorTools = [gscMonitorUrlsTool] as const;
