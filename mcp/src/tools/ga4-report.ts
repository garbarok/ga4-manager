import { z } from 'zod';

/**
 * Input schema for ga4_report tool
 *
 * Supports three mutually exclusive ways to specify config:
 * - config_path: Full path to YAML config file
 * - project_name: Config file name (without .yaml extension)
 * - all: Report on all available configs
 *
 * Note: No dry_run option - report is a read-only operation.
 */
export const ga4ReportInputSchema = z.object({
  /** Path to YAML config file */
  config_path: z.string().optional(),
  /** Config file name (without .yaml) */
  project_name: z.string().optional(),
  /** Report on all available configs */
  all: z.boolean().optional(),
}).refine(
  (data) => data.config_path || data.project_name || data.all,
  {
    error: 'At least one of config_path, project_name, or all must be provided',
  }
);

export type GA4ReportInput = z.infer<typeof ga4ReportInputSchema>;

/**
 * Conversion event from report
 */
export interface ConversionInfo {
  name: string;
  counting_method: string;
}

/**
 * Custom dimension from report
 */
export interface DimensionInfo {
  parameter: string;
  display_name: string;
  scope: string;
}

/**
 * Custom metric from report
 */
export interface MetricInfo {
  parameter: string;
  display_name: string;
  unit: string;
  scope?: string;
}

/**
 * Calculated metric from report
 */
export interface CalculatedMetricInfo {
  display_name: string;
  formula: string;
  unit: string;
}

/**
 * Audience from report
 */
export interface AudienceInfo {
  name: string;
  category: string;
  duration_days: number;
}

/**
 * Data retention settings
 */
export interface DataRetentionInfo {
  months: number;
  reset_on_new_activity: boolean;
}

/**
 * Enhanced measurement status
 */
export interface EnhancedMeasurementInfo {
  enabled: boolean;
}

/**
 * Project info extracted from report
 */
export interface ProjectInfo {
  name?: string;
  property_id?: string;
}

/**
 * Report output structure
 */
export interface ReportOutput {
  success: boolean;
  operation: 'report';
  project?: ProjectInfo;
  conversions: ConversionInfo[];
  dimensions: DimensionInfo[];
  metrics: MetricInfo[];
  calculated_metrics?: CalculatedMetricInfo[];
  audiences?: AudienceInfo[];
  data_retention?: DataRetentionInfo;
  enhanced_measurement?: EnhancedMeasurementInfo;
  error?: string;
}

/**
 * Build CLI arguments from input
 *
 * @param input - Validated input
 * @returns Array of CLI arguments
 */
export function buildReportArgs(input: GA4ReportInput): string[] {
  const args: string[] = [];

  if (input.config_path) {
    args.push('--config', input.config_path);
  } else if (input.project_name) {
    args.push('--project', input.project_name);
  } else if (input.all) {
    args.push('--all');
  }

  return args;
}

/**
 * Parse CLI output into structured ReportOutput
 *
 * Extracts:
 * - Project info (name, property ID)
 * - Conversions table
 * - Custom dimensions table
 * - Custom metrics table
 * - Calculated metrics table
 * - Data retention settings
 * - Enhanced measurement status
 *
 * @param output - Raw CLI output
 * @returns Structured report output
 */
export function parseReportOutput(output: string): ReportOutput {
  const result: ReportOutput = {
    success: true,
    operation: 'report',
    conversions: [],
    dimensions: [],
    metrics: [],
  };

  // Check for errors
  const errorMatch = output.match(/Error:\s*(.+)/);
  if (errorMatch) {
    result.success = false;
    result.error = errorMatch[1].trim();
    return result;
  }

  // Extract project info from header line
  result.project = extractProjectInfo(output);

  // Parse tables
  result.conversions = parseConversionsTable(output);
  result.dimensions = parseDimensionsTable(output);
  result.metrics = parseMetricsTable(output);

  // Parse calculated metrics
  const calculatedMetrics = parseCalculatedMetricsTable(output);
  if (calculatedMetrics.length > 0) {
    result.calculated_metrics = calculatedMetrics;
  }

  // Parse audiences
  const audiences = parseAudiencesTable(output);
  if (audiences.length > 0) {
    result.audiences = audiences;
  }

  // Parse data retention settings
  const dataRetention = parseDataRetention(output);
  if (dataRetention) {
    result.data_retention = dataRetention;
  }

  // Parse enhanced measurement
  const enhancedMeasurement = parseEnhancedMeasurement(output);
  if (enhancedMeasurement) {
    result.enhanced_measurement = enhancedMeasurement;
  }

  return result;
}

/**
 * Extract project info from output header
 */
function extractProjectInfo(output: string): ProjectInfo | undefined {
  // Match: "Project Name (Property: 123456789)"
  const projectMatch = output.match(/([^\n]+?)\s*\(Property:\s*(\d+)\)/);
  if (projectMatch) {
    // Clean up project name - remove emoji prefix
    let name = projectMatch[1].trim();
    // Remove common emoji prefixes
    name = name.replace(/^[^\w\s]*\s*/, '').trim();

    return {
      name,
      property_id: projectMatch[2],
    };
  }

  return undefined;
}

/**
 * Parse conversions table section
 */
function parseConversionsTable(output: string): ConversionInfo[] {
  const conversions: ConversionInfo[] = [];

  // Find the conversions section
  const conversionsSection = extractSection(output, 'Conversions', 'Custom Dimensions');
  if (!conversionsSection) return conversions;

  // Parse table rows
  const rows = parseTableRows(conversionsSection, ['EVENT NAME', 'COUNTING METHOD']);

  for (const row of rows) {
    if (row['EVENT NAME'] && row['COUNTING METHOD']) {
      conversions.push({
        name: String(row['EVENT NAME']),
        counting_method: String(row['COUNTING METHOD']),
      });
    }
  }

  return conversions;
}

/**
 * Parse dimensions table section
 */
function parseDimensionsTable(output: string): DimensionInfo[] {
  const dimensions: DimensionInfo[] = [];

  // Find the dimensions section
  const dimensionsSection = extractSection(output, 'Custom Dimensions', 'Custom Metrics');
  if (!dimensionsSection) return dimensions;

  // Parse table rows
  const rows = parseTableRows(dimensionsSection, ['DISPLAY NAME', 'PARAMETER', 'SCOPE']);

  for (const row of rows) {
    if (row['DISPLAY NAME'] && row['PARAMETER'] && row['SCOPE']) {
      dimensions.push({
        parameter: String(row['PARAMETER']),
        display_name: String(row['DISPLAY NAME']),
        scope: String(row['SCOPE']),
      });
    }
  }

  return dimensions;
}

/**
 * Parse metrics table section
 */
function parseMetricsTable(output: string): MetricInfo[] {
  const metrics: MetricInfo[] = [];

  // Find the metrics section
  const metricsSection = extractSection(output, 'Custom Metrics', 'Calculated Metrics');
  if (!metricsSection) return metrics;

  // Parse table rows
  const rows = parseTableRows(metricsSection, ['DISPLAY NAME', 'PARAMETER', 'UNIT', 'SCOPE']);

  for (const row of rows) {
    if (row['DISPLAY NAME'] && row['PARAMETER'] && row['UNIT']) {
      metrics.push({
        parameter: String(row['PARAMETER']),
        display_name: String(row['DISPLAY NAME']),
        unit: String(row['UNIT']),
        scope: row['SCOPE'] ? String(row['SCOPE']) : undefined,
      });
    }
  }

  return metrics;
}

/**
 * Parse calculated metrics table section
 */
function parseCalculatedMetricsTable(output: string): CalculatedMetricInfo[] {
  const calculatedMetrics: CalculatedMetricInfo[] = [];

  // Find the calculated metrics section
  const section = extractSection(output, 'Calculated Metrics', 'Configured Audiences');
  if (!section) return calculatedMetrics;

  // Parse table rows
  const rows = parseTableRows(section, ['DISPLAY NAME', 'FORMULA', 'UNIT']);

  for (const row of rows) {
    if (row['DISPLAY NAME'] && row['FORMULA'] && row['UNIT']) {
      calculatedMetrics.push({
        display_name: String(row['DISPLAY NAME']),
        formula: String(row['FORMULA']),
        unit: String(row['UNIT']),
      });
    }
  }

  return calculatedMetrics;
}

/**
 * Parse audiences table section
 */
function parseAudiencesTable(output: string): AudienceInfo[] {
  const audiences: AudienceInfo[] = [];

  // Find the audiences section
  const section = extractSection(output, 'Configured Audiences', 'Data Retention');
  if (!section) return audiences;

  // Parse table rows
  const rows = parseTableRows(section, ['NAME', 'CATEGORY', 'DURATION']);

  for (const row of rows) {
    if (row['NAME'] && row['CATEGORY'] && row['DURATION']) {
      const durationMatch = String(row['DURATION']).match(/(\d+)/);
      const duration = durationMatch ? parseInt(durationMatch[1], 10) : 0;

      audiences.push({
        name: String(row['NAME']),
        category: String(row['CATEGORY']),
        duration_days: duration,
      });
    }
  }

  return audiences;
}

/**
 * Parse data retention settings
 */
function parseDataRetention(output: string): DataRetentionInfo | undefined {
  // Match: "Event Data Retention: 14 months (FOURTEEN_MONTHS)"
  const monthsMatch = output.match(/Event Data Retention:\s*(\d+)\s*months/i);
  const resetMatch = output.match(/Reset on New Activity:\s*(true|false)/i);

  if (monthsMatch) {
    return {
      months: parseInt(monthsMatch[1], 10),
      reset_on_new_activity: resetMatch ? resetMatch[1].toLowerCase() === 'true' : false,
    };
  }

  return undefined;
}

/**
 * Parse enhanced measurement status
 */
function parseEnhancedMeasurement(output: string): EnhancedMeasurementInfo | undefined {
  // Match: "Enhanced Measurement enabled" or "Enhanced Measurement disabled"
  if (output.includes('Enhanced Measurement enabled')) {
    return { enabled: true };
  }
  if (output.includes('Enhanced Measurement disabled')) {
    return { enabled: false };
  }

  return undefined;
}

/**
 * Extract a section between two markers
 */
function extractSection(output: string, startMarker: string, endMarker: string): string | null {
  const startIdx = output.indexOf(startMarker);
  if (startIdx === -1) return null;

  const endIdx = endMarker ? output.indexOf(endMarker, startIdx) : -1;
  const section = endIdx === -1
    ? output.slice(startIdx)
    : output.slice(startIdx, endIdx);

  return section;
}

/**
 * Parse table rows from a section
 *
 * Handles tablewriter output format. Tables look like:
 *
 *               EVENT NAME           | COUNTING METHOD
 *   ---------------------------------+-------------------
 *     purchase                       | ONCE_PER_EVENT
 *     contact_form_submit            | ONCE_PER_SESSION
 *
 * The previous implementation computed fixed column positions from the
 * header line and used substring(start, end) to extract values. That broke
 * because tablewriter centers headers (left-pads with spaces) but
 * left-aligns data values, so the computed start position was inside a
 * word for data rows — producing fragments like "rm_submit" instead of
 * "contact_form_submit".
 *
 * This implementation splits each row on the `|` separator instead, which
 * is robust against any horizontal alignment. It also skips border/
 * separator lines that contain `+`, `|`, `-`, `=`, or unicode box-drawing
 * characters — the previous regex missed `+` and `|`, causing rows like
 * `+--------+----+` to be parsed as data.
 */
function parseTableRows(section: string, expectedHeaders: string[]): Array<Record<string, string>> {
  const lines = section.split('\n').filter(line => line.trim().length > 0);
  const rows: Array<Record<string, string>> = [];

  // Find the header line: the first line whose pipe-separated cells contain
  // all of the expected header substrings.
  let headerLineIdx = -1;
  let columnNames: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = splitPipes(lines[i]).map(c => c.trim().toUpperCase());
    if (cells.length < expectedHeaders.length) continue;

    const allHeadersPresent = expectedHeaders.every(h => cells.some(c => c.includes(h)));
    if (allHeadersPresent) {
      headerLineIdx = i;
      columnNames = cells;
      break;
    }
  }

  if (headerLineIdx === -1) return rows;

  // Border / separator regex — anything made entirely of border characters,
  // including `+` (corner) and `|` (vertical) which tablewriter uses.
  const borderRegex = /^[\s─\-═+|]+$/;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (borderRegex.test(line) || line.trim().length === 0) continue;

    const cells = splitPipes(line).map(c => c.trim());
    if (cells.length < expectedHeaders.length) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < columnNames.length && j < cells.length; j++) {
      const value = cells[j];
      if (value) row[columnNames[j]] = value;
    }

    if (Object.keys(row).length > 0) rows.push(row);
  }

  return rows;
}

/**
 * Split a tablewriter row on `|` separators.
 *
 * Tablewriter typically renders rows as:
 *   `  cell1  | cell2  | cell3 `
 * with optional leading/trailing whitespace. We split on `|`, then drop
 * empty leading/trailing cells produced by leading/trailing pipes in some
 * tablewriter configurations.
 */
function splitPipes(line: string): string[] {
  const cells = line.split('|');
  // Drop a leading empty cell if the row starts with `|`.
  if (cells.length > 0 && cells[0].trim() === '' && line.trimStart().startsWith('|')) {
    cells.shift();
  }
  // Drop a trailing empty cell if the row ends with `|`.
  if (cells.length > 0 && cells[cells.length - 1].trim() === '' && line.trimEnd().endsWith('|')) {
    cells.pop();
  }
  return cells;
}

/**
 * MCP Tool definition for ga4_report
 */
export const ga4ReportTool = {
  name: 'ga4_report',
  description: 'Generate GA4 configuration reports showing conversions, dimensions, metrics, and settings',
  inputSchema: {
    type: 'object',
    properties: {
      config_path: {
        type: 'string',
        description: 'Path to YAML config file'
      },
      project_name: {
        type: 'string',
        description: 'Config file name (without .yaml)'
      },
      all: {
        type: 'boolean',
        description: 'Report on all available configs'
      },
    },
    // Note: Zod schema handles mutual exclusivity validation
    // MCP doesn't support oneOf at top level
  },
  annotations: {
    title: 'Run GA4 report',
    readOnlyHint: true,
  },
};
