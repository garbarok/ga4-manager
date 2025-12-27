import { z } from 'zod';

// ============================================================================
// Valid Values for GSC Analytics
// ============================================================================

/**
 * Valid dimensions for Search Analytics queries
 * Max 3 dimensions allowed by GSC API
 */
export const VALID_DIMENSIONS = [
  'query',
  'page',
  'country',
  'device',
  'searchAppearance',
  'date',
] as const;

export type ValidDimension = typeof VALID_DIMENSIONS[number];

/**
 * Valid output formats
 */
export const VALID_FORMATS = ['json', 'csv', 'table', 'markdown'] as const;
export type ValidFormat = typeof VALID_FORMATS[number];

// ============================================================================
// GSC Analytics Run Tool
// ============================================================================

/**
 * Input schema for gsc_analytics_run tool
 *
 * Generates search analytics reports from Google Search Console.
 * This is the most important GSC tool for agents analyzing search performance.
 */
export const gscAnalyticsRunInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().optional(),
  /** Path to configuration file (alternative to site) */
  config: z.string().optional(),
  /** Number of days to query (1-180, default: 30) */
  days: z.number().int().min(1).max(180).optional().default(30),
  /** Comma-separated dimensions (max 3): query, page, country, device, searchAppearance, date */
  dimensions: z.string().optional().default('query,page'),
  /** Maximum rows to return (1-25000, default: 100) */
  limit: z.number().int().min(1).max(25000).optional().default(100),
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

export type GscAnalyticsRunInput = z.infer<typeof gscAnalyticsRunInputSchema>;

/**
 * Query metadata returned with analytics results
 */
export interface AnalyticsQueryMetadata {
  query_date: string;
  start_date: string;
  end_date: string;
  dimensions: string[];
  row_limit: number;
  filter_count: number;
}

/**
 * Aggregated metrics across all rows
 */
export interface AnalyticsAggregates {
  total_clicks: number;
  total_impressions: number;
  average_ctr: number;
  average_position: number;
}

/**
 * Single row of analytics data
 */
export interface AnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Quota status information
 */
export interface QuotaStatus {
  date: string;
  queries_used: number;
  queries_limit: number;
  remaining: number;
  percentage_used: number;
  status: 'healthy' | 'warning' | 'critical';
}

/**
 * Dry-run query preview
 */
export interface DryRunQuery {
  site_url: string;
  start_date: string;
  end_date: string;
  dimensions: string[];
  row_limit: number;
  data_state: string;
  filters?: Array<{
    dimension: string;
    operator: string;
    expression: string;
  }>;
}

/**
 * Analytics run output structure
 */
export interface AnalyticsRunOutput {
  success: boolean;
  operation: 'analytics';
  site?: string;
  period?: string;
  total_rows?: number;
  aggregates?: AnalyticsAggregates;
  rows?: AnalyticsRow[];
  metadata?: AnalyticsQueryMetadata;
  quota?: QuotaStatus;
  dry_run?: DryRunQuery;
  error?: string;
  validation_errors?: string[];
}

/**
 * Validate dimensions string
 */
export function validateDimensions(dimensionsStr: string): { valid: boolean; dimensions: string[]; errors: string[] } {
  const dimensions = dimensionsStr.split(',').map(d => d.trim()).filter(d => d.length > 0);
  const errors: string[] = [];

  if (dimensions.length === 0) {
    errors.push('At least one dimension is required');
  }

  if (dimensions.length > 3) {
    errors.push(`Maximum 3 dimensions allowed (GSC API limit), got ${dimensions.length}`);
  }

  const invalidDims = dimensions.filter(d => !VALID_DIMENSIONS.includes(d as ValidDimension));
  if (invalidDims.length > 0) {
    errors.push(`Invalid dimension(s): ${invalidDims.join(', ')}. Valid: ${VALID_DIMENSIONS.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    dimensions,
    errors,
  };
}

/**
 * Build CLI arguments for analytics run
 */
export function buildAnalyticsRunArgs(input: GscAnalyticsRunInput): string[] {
  const args: string[] = ['gsc', 'analytics', 'run'];

  if (input.config) {
    args.push('--config', input.config);
  } else if (input.site) {
    args.push('--site', input.site);
  }

  if (input.days !== undefined && input.days !== 30) {
    args.push('--days', input.days.toString());
  }

  if (input.dimensions !== undefined && input.dimensions !== 'query,page') {
    args.push('--dimensions', input.dimensions);
  }

  if (input.limit !== undefined && input.limit !== 100) {
    args.push('--limit', input.limit.toString());
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
 * Parse CLI output for analytics run
 */
export function parseAnalyticsRunOutput(output: string): AnalyticsRunOutput {
  const result: AnalyticsRunOutput = {
    success: true,
    operation: 'analytics',
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

  // Check for query execution errors
  if (output.includes('Failed to query search analytics:')) {
    result.success = false;
    const errorMatch = output.match(/Failed to query search analytics:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to query search analytics';
    return result;
  }

  // Check for config loading errors
  if (output.includes('Failed to load config:')) {
    result.success = false;
    const errorMatch = output.match(/Failed to load config:\s*(.+)/);
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to load config';
    return result;
  }

  // Check for missing search_console config
  if (output.includes('No search_console configuration found')) {
    result.success = false;
    result.error = 'No search_console configuration found in config file';
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
function parseDryRunOutput(output: string): AnalyticsRunOutput {
  const result: AnalyticsRunOutput = {
    success: true,
    operation: 'analytics',
  };

  const dryRun: DryRunQuery = {
    site_url: '',
    start_date: '',
    end_date: '',
    dimensions: [],
    row_limit: 0,
    data_state: 'final',
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

  // Extract Dimensions
  const dimensionsMatch = output.match(/Dimensions:\s*(.+)/);
  if (dimensionsMatch) {
    dryRun.dimensions = dimensionsMatch[1].trim().split(',').map(d => d.trim());
  }

  // Extract Row Limit
  const rowLimitMatch = output.match(/Row Limit:\s*(\d+)/);
  if (rowLimitMatch) {
    dryRun.row_limit = parseInt(rowLimitMatch[1], 10);
  }

  // Extract Data State
  const dataStateMatch = output.match(/Data State:\s*(\w+)/);
  if (dataStateMatch) {
    dryRun.data_state = dataStateMatch[1].trim();
  }

  // Extract Filters if present
  const filtersSection = output.match(/Filters:\s*([\s\S]*?)(?=\n\n|No API call made)/);
  if (filtersSection) {
    const filterRegex = /\d+\.\s*(\w+)\s+(\w+)\s+'([^']+)'/g;
    const filters: DryRunQuery['filters'] = [];
    let filterMatch;
    while ((filterMatch = filterRegex.exec(filtersSection[1])) !== null) {
      filters.push({
        dimension: filterMatch[1],
        operator: filterMatch[2],
        expression: filterMatch[3],
      });
    }
    if (filters.length > 0) {
      dryRun.filters = filters;
    }
  }

  result.dry_run = dryRun;
  return result;
}

/**
 * Parse JSON output from CLI
 */
function parseJsonOutput(output: string): AnalyticsRunOutput {
  const result: AnalyticsRunOutput = {
    success: true,
    operation: 'analytics',
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

    result.site = data.SiteURL || data.site_url;
    result.period = data.Period || data.period;
    result.total_rows = data.TotalRows || data.total_rows || 0;

    // Parse aggregates
    const agg = data.Aggregates || data.aggregates;
    if (agg) {
      result.aggregates = {
        total_clicks: agg.TotalClicks || agg.total_clicks || 0,
        total_impressions: agg.TotalImpressions || agg.total_impressions || 0,
        average_ctr: agg.AverageCTR || agg.average_ctr || 0,
        average_position: agg.AveragePosition || agg.average_position || 0,
      };
    }

    // Parse rows
    const rows = data.Rows || data.rows;
    if (rows && Array.isArray(rows)) {
      result.rows = rows.map((row: Record<string, unknown>) => ({
        keys: (row.Keys || row.keys || []) as string[],
        clicks: (row.Clicks || row.clicks || 0) as number,
        impressions: (row.Impressions || row.impressions || 0) as number,
        ctr: (row.CTR || row.ctr || 0) as number,
        position: (row.Position || row.position || 0) as number,
      }));
    }

    // Parse metadata
    const meta = data.Metadata || data.metadata;
    if (meta) {
      result.metadata = {
        query_date: meta.QueryDate || meta.query_date || '',
        start_date: meta.StartDate || meta.start_date || '',
        end_date: meta.EndDate || meta.end_date || '',
        dimensions: meta.Dimensions || meta.dimensions || [],
        row_limit: meta.RowLimit || meta.row_limit || 0,
        filter_count: meta.FilterCount || meta.filter_count || 0,
      };
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
function parseTableOutput(output: string): AnalyticsRunOutput {
  const result: AnalyticsRunOutput = {
    success: true,
    operation: 'analytics',
  };

  // Check for no data
  if (output.includes('No data found for this query')) {
    result.total_rows = 0;
    result.rows = [];
    result.aggregates = {
      total_clicks: 0,
      total_impressions: 0,
      average_ctr: 0,
      average_position: 0,
    };
    return result;
  }

  // Extract site from output
  const siteMatch = output.match(/Querying search analytics for\s+(\S+)/);
  if (siteMatch) {
    result.site = siteMatch[1].trim();
  }

  // Extract date range
  const dateRangeMatch = output.match(/Date range:\s*(\S+)\s+to\s+(\S+)\s+\((\d+)\s+days\)/);
  if (dateRangeMatch) {
    result.period = `${dateRangeMatch[1]} to ${dateRangeMatch[2]}`;
  }

  // Extract summary section
  const periodMatch = output.match(/Period:\s*(.+)/);
  if (periodMatch) {
    result.period = periodMatch[1].trim();
  }

  const totalRowsMatch = output.match(/Total Rows:\s*(\d+)/);
  if (totalRowsMatch) {
    result.total_rows = parseInt(totalRowsMatch[1], 10);
  }

  const totalClicksMatch = output.match(/Total Clicks:\s*(\d+)/);
  const totalImpressionsMatch = output.match(/Total Impressions:\s*(\d+)/);
  const avgCtrMatch = output.match(/Average CTR:\s*([\d.]+)%/);
  const avgPositionMatch = output.match(/Avg(?:erage)? Position:\s*([\d.]+)/);

  if (totalClicksMatch || totalImpressionsMatch) {
    result.aggregates = {
      total_clicks: totalClicksMatch ? parseInt(totalClicksMatch[1], 10) : 0,
      total_impressions: totalImpressionsMatch ? parseInt(totalImpressionsMatch[1], 10) : 0,
      average_ctr: avgCtrMatch ? parseFloat(avgCtrMatch[1]) / 100 : 0,
      average_position: avgPositionMatch ? parseFloat(avgPositionMatch[1]) : 0,
    };
  }

  // Parse quota status if present
  const quotaSection = output.match(/Daily Quota Status[\s\S]*?Quota usage (\w+)/);
  if (quotaSection) {
    const quotaDateMatch = output.match(/Date:\s*(\S+)/);
    const queriesUsedMatch = output.match(/Queries Used:\s*(\d+)\s*\/\s*(\d+)\s*\(([\d.]+)%\)/);
    const remainingMatch = output.match(/Remaining:\s*(\d+)/);

    if (queriesUsedMatch) {
      const usedPercent = parseFloat(queriesUsedMatch[3]);
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (usedPercent >= 95) {
        status = 'critical';
      } else if (usedPercent >= 75) {
        status = 'warning';
      }

      result.quota = {
        date: quotaDateMatch ? quotaDateMatch[1] : '',
        queries_used: parseInt(queriesUsedMatch[1], 10),
        queries_limit: parseInt(queriesUsedMatch[2], 10),
        remaining: remainingMatch ? parseInt(remainingMatch[1], 10) : 0,
        percentage_used: usedPercent,
        status,
      };
    }
  }

  return result;
}

/**
 * MCP Tool definition for gsc_analytics_run
 *
 * This is the most important GSC tool - agents will use it frequently
 * to analyze search performance, track rankings, and identify content opportunities.
 */
export const gscAnalyticsRunTool = {
  name: 'gsc_analytics_run',
  description: 'Generate search analytics reports from Google Search Console. Query search performance data including top queries, landing pages, CTR, positions, and more. This is the primary tool for SEO analysis and search performance monitoring.',
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
        description: 'Number of days to query (1-180). Default: 30. Data is typically 2-3 days behind.',
        default: 30,
        minimum: 1,
        maximum: 180,
      },
      dimensions: {
        type: 'string',
        description: 'Comma-separated dimensions (max 3). Valid: query, page, country, device, searchAppearance, date. Default: query,page.',
        default: 'query,page',
      },
      limit: {
        type: 'number',
        description: 'Maximum rows to return (1-25000). Default: 100.',
        default: 100,
        minimum: 1,
        maximum: 25000,
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
    oneOf: [
      { required: ['site'] },
      { required: ['config'] },
    ],
  },
};

// ============================================================================
// Exports
// ============================================================================

export const gscAnalyticsTools = [
  gscAnalyticsRunTool,
] as const;
