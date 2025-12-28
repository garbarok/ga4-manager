import { z } from 'zod';

/**
 * Input schema for ga4_validate tool
 *
 * Supports three mutually exclusive ways to specify what to validate:
 * - config_file: Full path to a YAML config file
 * - all: Validate all config files in configs/ directory
 *
 * verbose can be combined with any of the above.
 */
export const ga4ValidateInputSchema = z.object({
  /** Path to YAML config file */
  config_file: z.string().optional(),
  /** Validate all config files */
  all: z.boolean().optional(),
  /** Show detailed validation results */
  verbose: z.boolean().optional(),
}).refine(
  (data) => data.config_file || data.all,
  {
    error: 'At least one of config_file or all must be provided',
  }
);

export type GA4ValidateInput = z.infer<typeof ga4ValidateInputSchema>;

/**
 * Tier limits info from config
 */
export interface TierLimitsInfo {
  tier: string;
  tier_name: string;
  conversions_limit: number;
  dimensions_limit: number;
  metrics_limit: number;
}

/**
 * Config summary extracted from verbose output
 */
export interface ConfigSummary {
  project_name: string;
  property_id: string;
  tier: TierLimitsInfo;
  conversions_count: number;
  dimensions_count: number;
  metrics_count: number;
  calculated_metrics_count: number;
  audiences_count: number;
  cleanup_conversions: number;
  cleanup_dimensions: number;
}

/**
 * Single file validation result
 */
export interface FileValidationResult {
  file_path: string;
  valid: boolean;
  yaml_syntax: 'ok' | 'failed' | 'skipped';
  config_structure: 'ok' | 'failed' | 'skipped';
  tier_limits: 'ok' | 'warnings' | 'skipped';
  warnings?: string[];
  error?: string;
  summary?: ConfigSummary;
}

/**
 * Overall validation output structure
 */
export interface ValidateOutput {
  success: boolean;
  operation: 'validate';
  total_files: number;
  valid_files: number;
  invalid_files: number;
  results: FileValidationResult[];
  verbose: boolean;
}

/**
 * Build CLI arguments from input
 *
 * @param input - Validated input
 * @returns Array of CLI arguments
 */
export function buildValidateArgs(input: GA4ValidateInput): string[] {
  const args: string[] = [];

  if (input.all) {
    args.push('--all');
  } else if (input.config_file) {
    // First positional argument is the config file
    args.push(input.config_file);
  }

  if (input.verbose) {
    args.push('--verbose');
  }

  return args;
}

/**
 * Parse CLI output into structured ValidateOutput
 *
 * Extracts:
 * - Individual file validation results
 * - YAML syntax check status
 * - Config structure check status
 * - Tier limits warnings
 * - Config summaries (in verbose mode)
 *
 * @param output - Raw CLI output
 * @param verbose - Whether verbose mode was enabled
 * @returns Structured validation output
 */
export function parseValidateOutput(output: string, verbose: boolean): ValidateOutput {
  const result: ValidateOutput = {
    success: true,
    operation: 'validate',
    total_files: 0,
    valid_files: 0,
    invalid_files: 0,
    results: [],
    verbose,
  };

  // Parse validation results summary
  const summaryMatch = output.match(/Validation Results:\s*(\d+)\s*total,\s*(\d+)\s*valid,\s*(\d+)\s*invalid/);
  if (summaryMatch) {
    result.total_files = parseInt(summaryMatch[1], 10);
    result.valid_files = parseInt(summaryMatch[2], 10);
    result.invalid_files = parseInt(summaryMatch[3], 10);
    result.success = result.invalid_files === 0;
  }

  // Parse individual file results
  result.results = parseFileResults(output, verbose);

  // Update counts from parsed results if summary wasn't found
  if (!summaryMatch && result.results.length > 0) {
    result.total_files = result.results.length;
    result.valid_files = result.results.filter(r => r.valid).length;
    result.invalid_files = result.results.filter(r => !r.valid).length;
    result.success = result.invalid_files === 0;
  }

  return result;
}

/**
 * Parse individual file validation results
 */
function parseFileResults(output: string, verbose: boolean): FileValidationResult[] {
  const results: FileValidationResult[] = [];

  // Split output by file validation sections
  // Each section starts with "Validating: <filepath>"
  const filePattern = /Validating:\s*([^\n]+)/g;
  let match;
  const filePaths: string[] = [];
  const filePositions: number[] = [];

  while ((match = filePattern.exec(output)) !== null) {
    filePaths.push(match[1].trim());
    filePositions.push(match.index);
  }

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const startPos = filePositions[i];
    const endPos = i < filePaths.length - 1 ? filePositions[i + 1] : output.length;
    const section = output.slice(startPos, endPos);

    const fileResult = parseFileSection(section, filePath, verbose);
    results.push(fileResult);
  }

  return results;
}

/**
 * Parse a single file's validation section
 */
function parseFileSection(section: string, filePath: string, verbose: boolean): FileValidationResult {
  const result: FileValidationResult = {
    file_path: filePath,
    valid: false,
    yaml_syntax: 'skipped',
    config_structure: 'skipped',
    tier_limits: 'skipped',
  };

  // Check YAML syntax
  if (section.includes('Checking YAML syntax...')) {
    if (section.match(/Checking YAML syntax\.\.\.\s*OK/i) ||
        section.match(/Checking YAML syntax\.\.\.[^\n]*OK/i)) {
      result.yaml_syntax = 'ok';
    } else if (section.match(/Checking YAML syntax\.\.\.\s*FAILED/i) ||
               section.match(/Checking YAML syntax\.\.\.[^\n]*FAILED/i)) {
      result.yaml_syntax = 'failed';
      result.error = extractYAMLError(section);
      result.valid = false;
      return result;
    }
  }

  // Check config structure
  if (section.includes('Checking config structure...')) {
    if (section.match(/Checking config structure\.\.\.\s*OK/i) ||
        section.match(/Checking config structure\.\.\.[^\n]*OK/i)) {
      result.config_structure = 'ok';
    } else if (section.match(/Checking config structure\.\.\.\s*FAILED/i) ||
               section.match(/Checking config structure\.\.\.[^\n]*FAILED/i)) {
      result.config_structure = 'failed';
      result.error = extractConfigError(section);
      result.valid = false;
      return result;
    }
  }

  // Check tier limits
  if (section.includes('Checking tier limits...')) {
    if (section.match(/Checking tier limits\.\.\.\s*OK/i) ||
        section.match(/Checking tier limits\.\.\.[^\n]*OK/i)) {
      result.tier_limits = 'ok';
    } else if (section.match(/Checking tier limits\.\.\.\s*WARNINGS/i) ||
               section.match(/Checking tier limits\.\.\.[^\n]*WARNINGS/i)) {
      result.tier_limits = 'warnings';
      result.warnings = extractTierWarnings(section);
    }
  }

  // Check for "Valid configuration" marker
  if (section.includes('Valid configuration')) {
    result.valid = true;
  }

  // Check for file not found
  if (section.includes('File not found')) {
    result.valid = false;
    result.error = 'File not found';
    return result;
  }

  // Extract config summary in verbose mode
  if (verbose && section.includes('Configuration Summary:')) {
    result.summary = extractConfigSummary(section);
  }

  return result;
}

/**
 * Extract YAML error details
 */
function extractYAMLError(section: string): string {
  // Try to find "Full error: <message>"
  const fullErrorMatch = section.match(/Full error:\s*([^\n]+)/);
  if (fullErrorMatch) {
    return fullErrorMatch[1].trim();
  }

  // Try to find "Error at line X:"
  const lineErrorMatch = section.match(/Error at line (\d+):/);
  if (lineErrorMatch) {
    return `YAML syntax error at line ${lineErrorMatch[1]}`;
  }

  return 'YAML syntax error';
}

/**
 * Extract config structure error
 */
function extractConfigError(section: string): string {
  // Look for indented error message after "FAILED"
  const errorMatch = section.match(/FAILED[^\n]*\n\s+([^\n]+)/);
  if (errorMatch) {
    return errorMatch[1].trim();
  }

  return 'Invalid configuration structure';
}

/**
 * Extract tier limit warnings
 */
function extractTierWarnings(section: string): string[] {
  const warnings: string[] = [];

  // Match warning lines (lines starting with warning symbol after WARNINGS)
  const warningsSection = section.match(/WARNINGS[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n.*Configuration Summary:|$)/);
  if (warningsSection) {
    const lines = warningsSection[1].split('\n');
    for (const line of lines) {
      // Match lines with warning symbol or indented warning text
      const warningMatch = line.match(/\s*[!]?\s*(.+)/);
      if (warningMatch && warningMatch[1].trim()) {
        warnings.push(warningMatch[1].trim());
      }
    }
  }

  return warnings.filter(w => w.length > 0);
}

/**
 * Extract config summary from verbose output
 */
function extractConfigSummary(section: string): ConfigSummary | undefined {
  const summary: Partial<ConfigSummary> = {};

  // Extract project name
  const projectMatch = section.match(/Project:\s*([^\n]+)/);
  if (projectMatch) {
    summary.project_name = projectMatch[1].trim();
  }

  // Extract property ID
  const propertyMatch = section.match(/Property ID:\s*([^\n]+)/);
  if (propertyMatch) {
    summary.property_id = propertyMatch[1].trim();
  }

  // Extract tier
  const tierMatch = section.match(/Tier:\s*([^\n]+)/);
  if (tierMatch) {
    summary.tier = {
      tier: tierMatch[1].trim().toLowerCase(),
      tier_name: tierMatch[1].trim(),
      conversions_limit: 0,
      dimensions_limit: 0,
      metrics_limit: 0,
    };
  }

  // Extract conversions count and limit
  const conversionsMatch = section.match(/Conversions:\s*(\d+)\s*\/\s*(\d+)/);
  if (conversionsMatch) {
    summary.conversions_count = parseInt(conversionsMatch[1], 10);
    if (summary.tier) {
      summary.tier.conversions_limit = parseInt(conversionsMatch[2], 10);
    }
  }

  // Extract dimensions count and limit
  const dimensionsMatch = section.match(/Dimensions:\s*(\d+)\s*\/\s*(\d+)/);
  if (dimensionsMatch) {
    summary.dimensions_count = parseInt(dimensionsMatch[1], 10);
    if (summary.tier) {
      summary.tier.dimensions_limit = parseInt(dimensionsMatch[2], 10);
    }
  }

  // Extract metrics count and limit
  const metricsMatch = section.match(/Metrics:\s*(\d+)\s*\/\s*(\d+)/);
  if (metricsMatch) {
    summary.metrics_count = parseInt(metricsMatch[1], 10);
    if (summary.tier) {
      summary.tier.metrics_limit = parseInt(metricsMatch[2], 10);
    }
  }

  // Extract calculated metrics count
  const calcMetricsMatch = section.match(/Calculated Metrics:\s*(\d+)/);
  if (calcMetricsMatch) {
    summary.calculated_metrics_count = parseInt(calcMetricsMatch[1], 10);
  }

  // Extract audiences count
  const audiencesMatch = section.match(/Audiences:\s*(\d+)/);
  if (audiencesMatch) {
    summary.audiences_count = parseInt(audiencesMatch[1], 10);
  }

  // Extract cleanup items
  const cleanupMatch = section.match(/Cleanup Items:\s*(\d+)\s*conversions,\s*(\d+)\s*dimensions/);
  if (cleanupMatch) {
    summary.cleanup_conversions = parseInt(cleanupMatch[1], 10);
    summary.cleanup_dimensions = parseInt(cleanupMatch[2], 10);
  } else {
    summary.cleanup_conversions = 0;
    summary.cleanup_dimensions = 0;
  }

  // Only return if we have minimum required fields
  if (summary.project_name && summary.property_id) {
    return summary as ConfigSummary;
  }

  return undefined;
}

/**
 * MCP Tool definition for ga4_validate
 */
export const ga4ValidateTool = {
  name: 'ga4_validate',
  description: 'Validate YAML configuration files for syntax, structure, and tier limits',
  inputSchema: {
    type: 'object',
    properties: {
      config_file: {
        type: 'string',
        description: 'Path to YAML config file to validate'
      },
      all: {
        type: 'boolean',
        description: 'Validate all config files in configs/ directory'
      },
      verbose: {
        type: 'boolean',
        description: 'Show detailed validation results including config summary'
      },
    },
    // Note: Zod schema handles mutual exclusivity validation
    // MCP doesn't support oneOf at top level
  },
};
