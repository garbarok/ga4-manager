import { z } from 'zod';

// ============================================================================
// Valid Values for GSC Coverage
// ============================================================================

/**
 * Valid state filters for coverage reports
 */
export const VALID_STATES = [
  'all',
  'indexed',
  'low_impressions',
  'no_impressions',
] as const;

export type ValidState = typeof VALID_STATES[number];

/**
 * Valid output formats
 */
export const VALID_FORMATS = ['json', 'csv', 'table', 'markdown'] as const;
export type ValidFormat = typeof VALID_FORMATS[number];

// ============================================================================
// GSC Index Coverage Tool
// ============================================================================

/**
 * Input schema for gsc_index_coverage tool
 *
 * Generates index coverage reports by analyzing Search Analytics data.
 * Provides estimates of indexed pages and coverage issues.
 */
export const gscIndexCoverageInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().optional(),
  /** Path to configuration file (alternative to site) */
  config: z.string().optional(),
  /** Number of days to analyze (1-180, default: 30) */
  days: z.number().int().min(1).max(180).optional().default(30),
  /** Filter by state: all, indexed, low_impressions, no_impressions (default: all) */
  state: z.enum(VALID_STATES).optional().default('all'),
  /** Number of top issues to display (default: 10) */
  top_issues: z.number().int().min(1).max(50).optional().default(10),
  /** Output format: json, csv, table, markdown (default: json) */
  format: z.enum(VALID_FORMATS).optional().default('json'),
  /** Preview query without making API call */
  dry_run: z.boolean().optional(),
}).refine(
  (data) => data.site || data.config,
  {
    message: 'Either site or config must be provided',
  }
);

export type GscIndexCoverageInput = z.infer<typeof gscIndexCoverageInputSchema>;

/**
 * Coverage issue with count
 */
export interface IssueCount {
  issue: string;
  count: number;
}

/**
 * Coverage status for a single page
 */
export interface PageCoverage {
  url: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  status: string;
}

/**
 * Index coverage report output
 */
export interface IndexCoverageOutput {
  success: boolean;
  operation: 'index_coverage';
  site?: string;
  period?: string;
  total_pages?: number;
  indexed_pages?: number;
  indexed_percentage?: number;
  issue_breakdown?: Record<string, number>;
  top_issues?: IssueCount[];
  pages_sample?: PageCoverage[];
  dry_run?: DryRunQuery;
  error?: string;
}

/**
 * Dry-run query preview
 */
export interface DryRunQuery {
  site_url: string;
  start_date: string;
  end_date: string;
  state_filter: string;
  top_issues_limit: number;
}

/**
 * Build CLI arguments for index coverage
 */
export function buildIndexCoverageArgs(input: GscIndexCoverageInput): string[] {
  const args: string[] = ['gsc', 'coverage'];

  if (input.config) {
    args.push('--config', input.config);
  } else if (input.site) {
    args.push('--site', input.site);
  }

  if (input.days !== undefined && input.days !== 30) {
    args.push('--days', input.days.toString());
  }

  if (input.state !== undefined && input.state !== 'all') {
    args.push('--state', input.state);
  }

  if (input.top_issues !== undefined && input.top_issues !== 10) {
    args.push('--top-issues', input.top_issues.toString());
  }

  if (input.format !== undefined && input.format !== 'json') {
    args.push('--format', input.format);
  }

  if (input.dry_run) {
    args.push('--dry-run');
  }

  return args;
}

/**
 * Parse CLI output for index coverage
 */
export function parseIndexCoverageOutput(output: string): IndexCoverageOutput {
  const result: IndexCoverageOutput = {
    success: true,
    operation: 'index_coverage',
  };

  // Check for validation errors
  if (output.includes('Validation failed:')) {
    result.success = false;
    const errorMatch = output.match(/Validation failed:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Validation failed';
    return result;
  }

  // Check for missing site/config error
  if (output.includes('Either --site or --config must be provided')) {
    result.success = false;
    result.error = 'Either --site or --config must be provided';
    return result;
  }

  // Check for client creation errors
  if (output.includes('Failed to create GSC client:')) {
    result.success = false;
    const errorMatch = output.match(/Failed to create GSC client:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to create GSC client';
    return result;
  }

  // Check for coverage report errors
  if (output.includes('Failed to generate coverage report:')) {
    result.success = false;
    const errorMatch = output.match(/Failed to generate coverage report:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to generate coverage report';
    return result;
  }

  // Check for config loading errors
  if (output.includes('Failed to load config:')) {
    result.success = false;
    const errorMatch = output.match(/Failed to load config:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to load config';
    return result;
  }

  // Parse dry-run output
  if (output.includes('Dry-run mode')) {
    return parseDryRunOutput(output);
  }

  // Parse JSON output (primary format for MCP)
  if (output.trim().startsWith('{')) {
    return parseJsonOutput(output);
  }

  // Parse table/markdown output
  return parseTableOutput(output);
}

/**
 * Parse dry-run preview output
 */
function parseDryRunOutput(output: string): IndexCoverageOutput {
  const result: IndexCoverageOutput = {
    success: true,
    operation: 'index_coverage',
  };

  const dryRun: DryRunQuery = {
    site_url: '',
    start_date: '',
    end_date: '',
    state_filter: 'all',
    top_issues_limit: 10,
  };

  // Extract Site URL
  const siteMatch = output.match(/Site URL:\s*(.+)/);
  if (siteMatch) {
    dryRun.site_url = siteMatch[1].trim();
    result.site = siteMatch[1].trim();
  }

  // Extract Date Range
  const dateRangeMatch = output.match(/Date Range:\s*(\S+)\s+to\s+(\S+)/);
  if (dateRangeMatch) {
    dryRun.start_date = dateRangeMatch[1].trim();
    dryRun.end_date = dateRangeMatch[2].trim();
    result.period = `${dateRangeMatch[1].trim()} to ${dateRangeMatch[2].trim()}`;
  }

  // Extract State Filter
  const stateMatch = output.match(/State Filter:\s*(.+)/);
  if (stateMatch) {
    dryRun.state_filter = stateMatch[1].trim();
  }

  // Extract Top Issues Limit
  const topIssuesMatch = output.match(/Top Issues:\s*(\d+)/);
  if (topIssuesMatch) {
    dryRun.top_issues_limit = parseInt(topIssuesMatch[1], 10);
  }

  result.dry_run = dryRun;
  return result;
}

/**
 * Parse JSON output from CLI
 */
function parseJsonOutput(output: string): IndexCoverageOutput {
  const result: IndexCoverageOutput = {
    success: true,
    operation: 'index_coverage',
  };

  try {
    // Find the JSON object in the output (may have preceding status messages)
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      result.success = false;
      result.error = 'No JSON data found in output';
      return result;
    }

    const data = JSON.parse(jsonMatch[0]);

    result.site = data.SiteURL || data.site_url || data.site;
    result.period = data.Period || data.period;
    result.total_pages = data.TotalPages || data.total_pages || 0;
    result.indexed_pages = data.IndexedPages || data.indexed_pages || 0;

    // Calculate indexed percentage
    if (result.total_pages && result.total_pages > 0) {
      result.indexed_percentage = (result.indexed_pages! / result.total_pages) * 100;
    }

    // Parse issue breakdown
    const issueBreakdown = data.IssueBreakdown || data.issue_breakdown;
    if (issueBreakdown) {
      result.issue_breakdown = issueBreakdown;
    }

    // Parse top issues
    const topIssues = data.TopIssues || data.top_issues;
    if (topIssues && Array.isArray(topIssues)) {
      result.top_issues = topIssues.map((issue: Record<string, unknown>) => ({
        issue: (issue.Issue || issue.issue || '') as string,
        count: (issue.Count || issue.count || 0) as number,
      }));
    }

    // Parse pages sample
    const pagesSample = data.PagesSample || data.pages_sample;
    if (pagesSample && Array.isArray(pagesSample)) {
      result.pages_sample = pagesSample.map((page: Record<string, unknown>) => ({
        url: (page.URL || page.url || '') as string,
        impressions: (page.Impressions || page.impressions || 0) as number,
        clicks: (page.Clicks || page.clicks || 0) as number,
        ctr: (page.CTR || page.ctr || 0) as number,
        position: (page.Position || page.position || 0) as number,
        status: (page.Status || page.status || '') as string,
      }));
    }

  } catch (e) {
    result.success = false;
    result.error = `Failed to parse JSON output: ${e instanceof Error ? e.message : 'Unknown error'}`;
  }

  return result;
}

/**
 * Parse table/markdown output from CLI
 */
function parseTableOutput(output: string): IndexCoverageOutput {
  const result: IndexCoverageOutput = {
    success: true,
    operation: 'index_coverage',
  };

  // Extract site from summary section
  const siteMatch = output.match(/Site:\s*(.+)/);
  if (siteMatch) {
    result.site = siteMatch[1].trim();
  }

  // Extract period
  const periodMatch = output.match(/Period:\s*(.+)/);
  if (periodMatch) {
    result.period = periodMatch[1].trim();
  }

  // Extract coverage statistics
  const totalPagesMatch = output.match(/Total Pages(?:\s+Found)?:\s*(\d+)/);
  if (totalPagesMatch) {
    result.total_pages = parseInt(totalPagesMatch[1], 10);
  }

  const indexedPagesMatch = output.match(/Indexed Pages:\s*(\d+)/);
  if (indexedPagesMatch) {
    result.indexed_pages = parseInt(indexedPagesMatch[1], 10);
  }

  const indexedPercentMatch = output.match(/Indexed(?:\s+%|Percentage):\s*([\d.]+)%/);
  if (indexedPercentMatch) {
    result.indexed_percentage = parseFloat(indexedPercentMatch[1]);
  }

  // Extract top issues from table or list
  const issuesSection = output.match(/Coverage Issues[\s\S]*?(?=Page Samples|Coverage Report Summary|$)/);
  if (issuesSection) {
    const topIssues: IssueCount[] = [];
    // Match table rows: | Issue Type | Count | ...
    const issueRegex = /\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/g;
    let issueMatch;
    while ((issueMatch = issueRegex.exec(issuesSection[0])) !== null) {
      const issue = issueMatch[1].trim();
      // Skip header row
      if (issue !== 'Issue Type' && issue !== '---') {
        topIssues.push({
          issue,
          count: parseInt(issueMatch[2], 10),
        });
      }
    }
    if (topIssues.length > 0) {
      result.top_issues = topIssues;
    }
  }

  return result;
}

/**
 * MCP Tool definition for gsc_index_coverage
 *
 * Estimates index coverage by analyzing search performance data.
 * Note: This is an estimate based on Search Analytics, not real-time coverage data.
 */
export const gscIndexCoverageTool = {
  name: 'gsc_index_coverage',
  description: 'Generate index coverage reports showing indexing status and statistics. Estimates coverage by analyzing search performance data including total pages, indexed pages, and coverage issues. Note: This is an estimate based on Search Analytics data, not real-time coverage from the GSC Coverage report.',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/). Required unless config is provided.',
      },
      config: {
        type: 'string',
        description: 'Path to configuration file with search_console settings. Alternative to site parameter.',
      },
      days: {
        type: 'number',
        description: 'Number of days to analyze (1-180). Default: 30. Analyzes search performance data for this period.',
        default: 30,
        minimum: 1,
        maximum: 180,
      },
      state: {
        type: 'string',
        enum: ['all', 'indexed', 'low_impressions', 'no_impressions'],
        description: 'Filter by state: all (show all pages), indexed (impressions >= 10), low_impressions (1-9 impressions), no_impressions (0 impressions). Default: all.',
        default: 'all',
      },
      top_issues: {
        type: 'number',
        description: 'Number of top coverage issues to display (1-50). Default: 10.',
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      format: {
        type: 'string',
        enum: ['json', 'csv', 'table', 'markdown'],
        description: 'Output format. Use json for structured data processing. Default: json.',
        default: 'json',
      },
      dry_run: {
        type: 'boolean',
        description: 'Preview query parameters without making the API call. Useful for validating configuration.',
        default: false,
      },
    },
  },
};

// ============================================================================
// Exports
// ============================================================================

export const gscCoverageTools = [
  gscIndexCoverageTool,
] as const;
