import { z } from 'zod';

/**
 * Input schema for ga4_cleanup tool
 *
 * Supports three mutually exclusive ways to specify config:
 * - config_path: Full path to YAML config file
 * - project_name: Config file name (without .yaml extension)
 * - all: Cleanup all available configs
 *
 * Additional options:
 * - type: What to cleanup (conversions, dimensions, metrics, or all)
 * - dry_run: Preview changes without applying
 * - yes: Skip confirmation prompt (auto-confirm)
 */
export const ga4CleanupInputSchema = z.object({
  /** Path to YAML config file */
  config_path: z.string().optional(),
  /** Config file name (without .yaml) */
  project_name: z.string().optional(),
  /** Cleanup all available configs */
  all: z.boolean().optional(),
  /** What to cleanup: conversions, dimensions, metrics, or all (default: all) */
  type: z.enum(['conversions', 'dimensions', 'metrics', 'all']).optional(),
  /** Preview changes without applying */
  dry_run: z.boolean().optional(),
  /** Skip confirmation prompt */
  yes: z.boolean().optional(),
}).refine(
  (data) => data.config_path || data.project_name || data.all,
  {
    error: 'At least one of config_path, project_name, or all must be provided',
  }
);

export type GA4CleanupInput = z.infer<typeof ga4CleanupInputSchema>;

/**
 * Item scheduled for removal
 */
export interface CleanupItem {
  name: string;
  status: 'will_delete' | 'will_archive' | 'deleted' | 'archived' | 'already_removed' | 'error';
  error?: string;
}

/**
 * Cleanup results for a specific type
 */
export interface CleanupTypeResults {
  items: CleanupItem[];
  removed: number;
  already_removed: number;
  errors: number;
}

/**
 * Project info extracted from cleanup output
 */
export interface ProjectInfo {
  name?: string;
  property_id?: string;
}

/**
 * Cleanup output structure
 */
export interface CleanupOutput {
  success: boolean;
  operation: 'cleanup';
  project?: ProjectInfo;
  conversions?: CleanupTypeResults;
  dimensions?: CleanupTypeResults;
  metrics?: CleanupTypeResults;
  dry_run: boolean;
  message?: string;
  error?: string;
}

/**
 * Build CLI arguments from input
 *
 * @param input - Validated input
 * @returns Array of CLI arguments
 */
export function buildCleanupArgs(input: GA4CleanupInput): string[] {
  const args: string[] = [];

  if (input.config_path) {
    args.push('--config', input.config_path);
  } else if (input.project_name) {
    args.push('--project', input.project_name);
  } else if (input.all) {
    args.push('--all');
  }

  if (input.type && input.type !== 'all') {
    args.push('--type', input.type);
  }

  if (input.dry_run) {
    args.push('--dry-run');
  }

  // Always add --yes to skip interactive prompts in MCP context
  args.push('--yes');

  return args;
}

/**
 * Parse CLI output into structured CleanupOutput
 *
 * Extracts:
 * - Project info (name, property ID)
 * - Conversions to remove and their status
 * - Dimensions to remove and their status
 * - Metrics to remove and their status
 * - Dry-run status
 * - Error messages
 *
 * @param output - Raw CLI output
 * @param dryRun - Whether this was a dry-run execution
 * @returns Structured cleanup output
 */
export function parseCleanupOutput(output: string, dryRun: boolean): CleanupOutput {
  const result: CleanupOutput = {
    success: true,
    operation: 'cleanup',
    dry_run: dryRun,
  };

  // Check for errors at top level
  const errorMatch = output.match(/Error:\s*(.+)/);
  if (errorMatch && !output.includes('Conversion Events to Remove')) {
    result.success = false;
    result.error = errorMatch[1].trim();
    return result;
  }

  // Extract project info
  result.project = extractProjectInfo(output);

  // Check for "no cleanup configured"
  if (output.includes('No cleanup configured for this project')) {
    result.message = 'No cleanup configured for this project';
    return result;
  }

  // Parse conversions section
  const conversions = parseConversionsSection(output, dryRun);
  if (conversions) {
    result.conversions = conversions;
  }

  // Parse dimensions section
  const dimensions = parseDimensionsSection(output, dryRun);
  if (dimensions) {
    result.dimensions = dimensions;
  }

  // Parse metrics section
  const metrics = parseMetricsSection(output, dryRun);
  if (metrics) {
    result.metrics = metrics;
  }

  // Check for completion status
  if (output.includes('Cleanup complete') || output.includes('Dry-run complete')) {
    result.success = true;
  }

  // Check if cleanup was cancelled
  if (output.includes('Cleanup cancelled')) {
    result.success = false;
    result.message = 'Cleanup cancelled by user';
  }

  return result;
}

/**
 * Extract project info from output
 */
function extractProjectInfo(output: string): ProjectInfo | undefined {
  // Match: "Project: MyWebsite (Property: 123456789)"
  const projectMatch = output.match(/Project:\s*([^\(]+)\s*\(Property:\s*(\d+)\)/);
  if (projectMatch) {
    return {
      name: projectMatch[1].trim(),
      property_id: projectMatch[2],
    };
  }

  return undefined;
}

/**
 * Parse conversions section
 */
function parseConversionsSection(output: string, dryRun: boolean): CleanupTypeResults | undefined {
  // Check if section exists
  if (!output.includes('Conversion Events to Remove') && !output.includes('Removing conversion events')) {
    return undefined;
  }

  const items: CleanupItem[] = [];
  let removed = 0;
  let alreadyRemoved = 0;
  let errors = 0;

  // In dry-run mode, parse the table
  if (dryRun) {
    const tableSection = extractSection(output, 'Conversion Events to Remove', 'Custom Dimensions to Remove');
    if (tableSection) {
      const tableItems = parseTableItems(tableSection, 'EVENT NAME');
      for (const name of tableItems) {
        items.push({ name, status: 'will_delete' });
      }
    }
    return { items, removed: items.length, already_removed: 0, errors: 0 };
  }

  // In execution mode, parse action results
  const section = extractSection(output, 'Removing conversion events', 'Archiving custom dimensions');
  if (section) {
    const lines = section.split('\n');
    for (const line of lines) {
      const successMatch = line.match(/[✓]\s+(.+?)(?:\s*$)/);
      const alreadyMatch = line.match(/[○]\s+(.+?)\s+\(already removed\)/);
      const errorMatch = line.match(/[✗]\s+(.+?):\s+(.+)/);

      if (successMatch) {
        items.push({ name: successMatch[1].trim(), status: 'deleted' });
        removed++;
      } else if (alreadyMatch) {
        items.push({ name: alreadyMatch[1].trim(), status: 'already_removed' });
        alreadyRemoved++;
      } else if (errorMatch) {
        items.push({ name: errorMatch[1].trim(), status: 'error', error: errorMatch[2].trim() });
        errors++;
      }
    }
  }

  return { items, removed, already_removed: alreadyRemoved, errors };
}

/**
 * Parse dimensions section
 */
function parseDimensionsSection(output: string, dryRun: boolean): CleanupTypeResults | undefined {
  // Check if section exists
  if (!output.includes('Custom Dimensions to Remove') && !output.includes('Archiving custom dimensions')) {
    return undefined;
  }

  const items: CleanupItem[] = [];
  let removed = 0;
  let alreadyRemoved = 0;
  let errors = 0;

  // In dry-run mode, parse the table
  if (dryRun) {
    const tableSection = extractSection(output, 'Custom Dimensions to Remove', 'Custom Metrics to Remove');
    if (tableSection) {
      const tableItems = parseTableItems(tableSection, 'PARAMETER NAME');
      for (const name of tableItems) {
        items.push({ name, status: 'will_archive' });
      }
    }
    return { items, removed: items.length, already_removed: 0, errors: 0 };
  }

  // In execution mode, parse action results
  const section = extractSection(output, 'Archiving custom dimensions', 'Archiving custom metrics');
  if (section) {
    const lines = section.split('\n');
    for (const line of lines) {
      const successMatch = line.match(/[✓]\s+(.+?)(?:\s*$)/);
      const alreadyMatch = line.match(/[○]\s+(.+?)\s+\(already archived\)/);
      const errorMatch = line.match(/[✗]\s+(.+?):\s+(.+)/);

      if (successMatch) {
        items.push({ name: successMatch[1].trim(), status: 'archived' });
        removed++;
      } else if (alreadyMatch) {
        items.push({ name: alreadyMatch[1].trim(), status: 'already_removed' });
        alreadyRemoved++;
      } else if (errorMatch) {
        items.push({ name: errorMatch[1].trim(), status: 'error', error: errorMatch[2].trim() });
        errors++;
      }
    }
  }

  return { items, removed, already_removed: alreadyRemoved, errors };
}

/**
 * Parse metrics section
 */
function parseMetricsSection(output: string, dryRun: boolean): CleanupTypeResults | undefined {
  // Check if section exists
  if (!output.includes('Custom Metrics to Remove') && !output.includes('Archiving custom metrics')) {
    return undefined;
  }

  const items: CleanupItem[] = [];
  let removed = 0;
  let alreadyRemoved = 0;
  let errors = 0;

  // In dry-run mode, parse the table
  if (dryRun) {
    const tableSection = extractSection(output, 'Custom Metrics to Remove', 'Dry-run mode enabled');
    if (tableSection) {
      const tableItems = parseTableItems(tableSection, 'PARAMETER NAME');
      for (const name of tableItems) {
        items.push({ name, status: 'will_archive' });
      }
    }
    return { items, removed: items.length, already_removed: 0, errors: 0 };
  }

  // In execution mode, parse action results
  const section = extractSection(output, 'Archiving custom metrics', 'Cleanup complete');
  if (section) {
    const lines = section.split('\n');
    for (const line of lines) {
      const successMatch = line.match(/[✓]\s+(.+?)(?:\s*$)/);
      const alreadyMatch = line.match(/[○]\s+(.+?)\s+\(already archived\)/);
      const errorMatch = line.match(/[✗]\s+(.+?):\s+(.+)/);

      if (successMatch) {
        items.push({ name: successMatch[1].trim(), status: 'archived' });
        removed++;
      } else if (alreadyMatch) {
        items.push({ name: alreadyMatch[1].trim(), status: 'already_removed' });
        alreadyRemoved++;
      } else if (errorMatch) {
        items.push({ name: errorMatch[1].trim(), status: 'error', error: errorMatch[2].trim() });
        errors++;
      }
    }
  }

  return { items, removed, already_removed: alreadyRemoved, errors };
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
 * Parse table items from a section
 *
 * Handles tablewriter output format
 */
function parseTableItems(section: string, headerColumn: string): string[] {
  const items: string[] = [];
  const lines = section.split('\n');

  // Find header line
  let headerLineIdx = -1;
  let headerStart = -1;
  let headerEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerIdx = line.toUpperCase().indexOf(headerColumn);
    if (headerIdx !== -1) {
      headerLineIdx = i;
      headerStart = headerIdx;
      // Find next column (STATUS)
      const statusIdx = line.toUpperCase().indexOf('STATUS');
      headerEnd = statusIdx !== -1 ? statusIdx : line.length;
      break;
    }
  }

  if (headerLineIdx === -1) return items;

  // Parse data rows
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip separator lines
    if (line.match(/^[\s─\-═|+]+$/) || line.trim().length === 0) {
      continue;
    }

    // Stop at next section marker
    if (line.includes('Custom') || line.includes('Dry-run') || line.includes('Cleanup')) {
      break;
    }

    // Extract value from column position
    if (line.length > headerStart) {
      const value = line.substring(headerStart, headerEnd).trim();
      if (value && !value.startsWith('─') && !value.startsWith('-')) {
        items.push(value);
      }
    }
  }

  return items;
}

/**
 * MCP Tool definition for ga4_cleanup
 */
export const ga4CleanupTool = {
  name: 'ga4_cleanup',
  description: 'Remove unused events, dimensions, and metrics from GA4',
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
        description: 'Cleanup all available configs'
      },
      type: {
        type: 'string',
        enum: ['conversions', 'dimensions', 'metrics', 'all'],
        default: 'all',
        description: 'What to cleanup: conversions, dimensions, metrics, or all'
      },
      dry_run: {
        type: 'boolean',
        description: 'Preview changes without applying'
      },
      yes: {
        type: 'boolean',
        description: 'Skip confirmation prompt (auto-confirm)'
      },
    },
    // Note: Zod schema handles mutual exclusivity validation
    // MCP doesn't support oneOf at top level
  },
};
