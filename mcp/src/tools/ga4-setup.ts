import { z } from 'zod';

/**
 * Input schema for ga4_setup tool
 *
 * Supports three mutually exclusive ways to specify config:
 * - config_path: Full path to YAML config file
 * - project_name: Config file name (without .yaml extension)
 * - all: Setup all available configs
 *
 * dry_run can be combined with any of the above.
 */
export const ga4SetupInputSchema = z.object({
  /** Path to YAML config file */
  config_path: z.string().optional(),
  /** Config file name (without .yaml) */
  project_name: z.string().optional(),
  /** Setup all available configs */
  all: z.boolean().optional(),
  /** Preview changes without applying */
  dry_run: z.boolean().optional(),
}).refine(
  (data) => data.config_path || data.project_name || data.all,
  {
    message: 'At least one of config_path, project_name, or all must be provided',
  }
);

export type GA4SetupInput = z.infer<typeof ga4SetupInputSchema>;

/**
 * GA4 setup results
 */
export interface GA4Results {
  conversions_created: number;
  conversions_skipped: number;
  dimensions_created: number;
  dimensions_skipped: number;
  metrics_created: number;
  metrics_skipped: number;
  errors?: string[];
}

/**
 * GSC setup results
 */
export interface GSCResults {
  sitemaps_submitted: number;
  sitemaps_skipped: number;
  errors?: string[];
}

/**
 * Project info extracted from output
 */
export interface ProjectInfo {
  name?: string;
  property_id?: string;
}

/**
 * Setup output structure
 */
export interface SetupOutput {
  success: boolean;
  operation: 'setup';
  project?: ProjectInfo;
  results: {
    ga4?: GA4Results;
    gsc?: GSCResults;
  };
  dry_run: boolean;
  execution_time_ms?: number;
}

/**
 * Build CLI arguments from input
 *
 * @param input - Validated input
 * @returns Array of CLI arguments
 */
export function buildSetupArgs(input: GA4SetupInput): string[] {
  const args: string[] = [];

  if (input.config_path) {
    args.push('--config', input.config_path);
  } else if (input.project_name) {
    args.push('--project', input.project_name);
  } else if (input.all) {
    args.push('--all');
  }

  if (input.dry_run) {
    args.push('--dry-run');
  }

  return args;
}

/**
 * Parse CLI output into structured SetupOutput
 *
 * Extracts:
 * - Property ID from validation output
 * - Created/skipped counts for conversions, dimensions, metrics
 * - Sitemap submission counts
 * - Errors and validation failures
 *
 * @param output - Raw CLI output
 * @param dryRun - Whether this was a dry-run execution
 * @returns Structured setup output
 */
export function parseSetupOutput(output: string, dryRun: boolean): SetupOutput {
  const result: SetupOutput = {
    success: true,
    operation: 'setup',
    results: {},
    dry_run: dryRun,
  };

  // Check for validation failures
  if (output.includes('pre-flight validation failed') ||
      output.includes('✗') && output.includes('Error:')) {
    result.success = false;

    // Extract error messages
    const errorLines = output.match(/Error: .+/g) || [];
    const errors = errorLines.map(line => line.replace('Error: ', '').trim());

    result.results.ga4 = {
      conversions_created: 0,
      conversions_skipped: 0,
      dimensions_created: 0,
      dimensions_skipped: 0,
      metrics_created: 0,
      metrics_skipped: 0,
      errors,
    };

    return result;
  }

  // Extract project info
  result.project = extractProjectInfo(output);

  // Check if GA4 section exists
  if (output.includes('Google Analytics 4 Setup') ||
      output.includes('Creating conversions')) {
    result.results.ga4 = parseGA4Section(output);
  }

  // Check if GSC section exists
  if (output.includes('Google Search Console Setup') ||
      output.includes('Submitting sitemaps')) {
    result.results.gsc = parseGSCSection(output);
  }

  // Check for overall success
  if (output.includes('Setup completed successfully') ||
      output.includes('Dry-run complete')) {
    result.success = true;
  } else if (output.includes('failed') || output.includes('error')) {
    result.success = false;
  }

  return result;
}

/**
 * Parse GA4 section of output
 */
function parseGA4Section(output: string): GA4Results {
  const results: GA4Results = {
    conversions_created: 0,
    conversions_skipped: 0,
    dimensions_created: 0,
    dimensions_skipped: 0,
    metrics_created: 0,
    metrics_skipped: 0,
    errors: [],
  };

  // Parse conversions section
  const conversionsMatch = extractCreatedSkipped(output, 'Creating conversions', 'Creating custom dimensions');
  if (conversionsMatch) {
    results.conversions_created = conversionsMatch.created;
    results.conversions_skipped = conversionsMatch.skipped;
  }

  // Parse dimensions section
  const dimensionsMatch = extractCreatedSkipped(output, 'Creating custom dimensions', 'Creating custom metrics');
  if (dimensionsMatch) {
    results.dimensions_created = dimensionsMatch.created;
    results.dimensions_skipped = dimensionsMatch.skipped;
  }

  // Parse metrics section
  const metricsMatch = extractCreatedSkipped(output, 'Creating custom metrics', 'Google Search Console Setup');
  if (metricsMatch) {
    results.metrics_created = metricsMatch.created;
    results.metrics_skipped = metricsMatch.skipped;
  }

  // Clean up errors array if empty
  if (results.errors && results.errors.length === 0) {
    delete results.errors;
  }

  return results;
}

/**
 * Parse GSC section of output
 */
function parseGSCSection(output: string): GSCResults {
  const results: GSCResults = {
    sitemaps_submitted: 0,
    sitemaps_skipped: 0,
    errors: [],
  };

  // Parse sitemaps section
  const sitemapsMatch = extractSubmittedSkipped(output);
  if (sitemapsMatch) {
    results.sitemaps_submitted = sitemapsMatch.submitted;
    results.sitemaps_skipped = sitemapsMatch.skipped;
  }

  // Clean up errors array if empty
  if (results.errors && results.errors.length === 0) {
    delete results.errors;
  }

  return results;
}

/**
 * Extract Created: X, Skipped: Y counts from a section
 */
function extractCreatedSkipped(
  output: string,
  sectionStart: string,
  sectionEnd: string
): { created: number; skipped: number } | null {
  const startIdx = output.indexOf(sectionStart);
  if (startIdx === -1) return null;

  const endIdx = sectionEnd ? output.indexOf(sectionEnd, startIdx) : output.length;
  const section = output.slice(startIdx, endIdx === -1 ? undefined : endIdx);

  // Look for "Created: X, Skipped: Y" pattern
  const match = section.match(/Created:\s*(\d+),?\s*Skipped:\s*(\d+)/);
  if (match) {
    return {
      created: parseInt(match[1], 10),
      skipped: parseInt(match[2], 10),
    };
  }

  return { created: 0, skipped: 0 };
}

/**
 * Extract project info from output
 */
function extractProjectInfo(output: string): ProjectInfo | undefined {
  const project: ProjectInfo = {};

  // Extract property ID from validation output
  const propertyMatch = output.match(/Property access verified \((\d+)\)/);
  if (propertyMatch) {
    project.property_id = propertyMatch[1];
  }

  // Extract config name from "Configuration loaded" message
  const configMatch = output.match(/Configuration loaded \(([^)]+)\)/);
  if (configMatch) {
    const configPath = configMatch[1];
    // Extract filename without extension
    const nameMatch = configPath.match(/([^/]+)\.ya?ml$/);
    if (nameMatch) {
      project.name = nameMatch[1];
    }
  }

  return Object.keys(project).length > 0 ? project : undefined;
}

/**
 * Extract Submitted: X, Skipped: Y counts for sitemaps
 */
function extractSubmittedSkipped(output: string): { submitted: number; skipped: number } | null {
  // Look for "Submitted: X, Skipped: Y" pattern
  const match = output.match(/Submitted:\s*(\d+),?\s*Skipped:\s*(\d+)/);
  if (match) {
    return {
      submitted: parseInt(match[1], 10),
      skipped: parseInt(match[2], 10),
    };
  }

  return null;
}

/**
 * MCP Tool definition for ga4_setup
 */
export const ga4SetupTool = {
  name: 'ga4_setup',
  description: 'Setup GA4/GSC from YAML config with pre-flight validation and rollback',
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
        description: 'Setup all available configs'
      },
      dry_run: {
        type: 'boolean',
        description: 'Preview changes without applying'
      },
    },
    // Note: Zod schema handles mutual exclusivity validation
    // MCP doesn't support oneOf at top level
  },
};
