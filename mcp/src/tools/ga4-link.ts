import { z } from 'zod';

/**
 * Input schema for ga4_link tool
 *
 * Links external services to GA4 properties:
 * - search-console: Generates setup guide for Search Console linking
 * - bigquery: Creates/manages BigQuery export links
 * - channels: Sets up default channel groupings
 *
 * Operations:
 * - Link a service (requires project_name + service)
 * - List existing links (requires project_name + list)
 * - Unlink a service (requires project_name + unlink)
 */
export const ga4LinkInputSchema = z.object({
  /** Config file name (without .yaml) - required for all operations */
  project_name: z.string(),
  /** Service to link */
  service: z.enum(['search-console', 'bigquery', 'channels']).optional(),
  /** Site URL for Search Console linking */
  url: z.string().optional(),
  /** GCP Project ID for BigQuery linking */
  gcp_project: z.string().optional(),
  /** BigQuery dataset ID */
  dataset: z.string().optional(),
  /** List existing links */
  list: z.boolean().optional(),
  /** Service to unlink */
  unlink: z.enum(['bigquery', 'channels']).optional(),
}).refine(
  (data) => data.service || data.list || data.unlink,
  {
    message: 'At least one of service, list, or unlink must be provided',
  }
).refine(
  (data) => {
    // If service is search-console, url is required
    if (data.service === 'search-console' && !data.url) {
      return false;
    }
    return true;
  },
  {
    message: 'url is required when service is search-console',
  }
).refine(
  (data) => {
    // If service is bigquery, gcp_project and dataset are required
    if (data.service === 'bigquery' && (!data.gcp_project || !data.dataset)) {
      return false;
    }
    return true;
  },
  {
    message: 'gcp_project and dataset are required when service is bigquery',
  }
);

export type GA4LinkInput = z.infer<typeof ga4LinkInputSchema>;

/**
 * BigQuery link information
 */
export interface BigQueryLinkInfo {
  name: string;
  project: string;
  daily_export: boolean;
  streaming_export: boolean;
}

/**
 * Channel group information
 */
export interface ChannelGroupInfo {
  name: string;
  display_name: string;
  system_defined: boolean;
}

/**
 * Search Console link information (manual check required)
 */
export interface SearchConsoleLinkInfo {
  status: 'manual_check_required';
  message: string;
}

/**
 * List links output
 */
export interface ListLinksOutput {
  search_console: SearchConsoleLinkInfo;
  bigquery: BigQueryLinkInfo[];
  channel_groups: ChannelGroupInfo[];
}

/**
 * Link operation result
 */
export interface LinkOperationResult {
  success: boolean;
  service: string;
  action: 'link' | 'unlink' | 'guide';
  message: string;
  details?: string;
}

/**
 * Project info extracted from output
 */
export interface ProjectInfo {
  name?: string;
  property_id?: string;
}

/**
 * Link output structure
 */
export interface LinkOutput {
  success: boolean;
  operation: 'link';
  project?: ProjectInfo;
  action: 'list' | 'link' | 'unlink';
  results?: ListLinksOutput | LinkOperationResult;
  error?: string;
}

/**
 * Build CLI arguments from input
 *
 * @param input - Validated input
 * @returns Array of CLI arguments
 */
export function buildLinkArgs(input: GA4LinkInput): string[] {
  const args: string[] = ['--project', input.project_name];

  if (input.list) {
    args.push('--list');
  } else if (input.unlink) {
    args.push('--unlink', input.unlink);
  } else if (input.service) {
    args.push('--service', input.service);

    if (input.service === 'search-console' && input.url) {
      args.push('--url', input.url);
    }

    if (input.service === 'bigquery') {
      if (input.gcp_project) {
        args.push('--gcp-project', input.gcp_project);
      }
      if (input.dataset) {
        args.push('--dataset', input.dataset);
      }
    }
  }

  return args;
}

/**
 * Parse CLI output into structured LinkOutput
 *
 * Handles three types of operations:
 * - List: Parses existing links for all services
 * - Link: Parses link creation result
 * - Unlink: Parses unlink operation result
 *
 * @param output - Raw CLI output
 * @param input - Original input for context
 * @returns Structured link output
 */
export function parseLinkOutput(output: string, input: GA4LinkInput): LinkOutput {
  const result: LinkOutput = {
    success: true,
    operation: 'link',
    action: input.list ? 'list' : input.unlink ? 'unlink' : 'link',
  };

  // Check for errors
  const errorMatch = output.match(/Error:\s*(.+)/);
  if (errorMatch) {
    result.success = false;
    result.error = errorMatch[1].trim();
    return result;
  }

  // Extract project info
  result.project = extractProjectInfo(output);

  if (input.list) {
    result.results = parseListOutput(output);
  } else if (input.unlink) {
    result.results = parseUnlinkOutput(output, input.unlink);
  } else if (input.service) {
    result.results = parseLinkServiceOutput(output, input.service);
  }

  return result;
}

/**
 * Extract project info from output
 */
function extractProjectInfo(output: string): ProjectInfo | undefined {
  // Match: "Project: ProjectName (Property: 123456789)"
  const projectMatch = output.match(/Project:\s*([^\n]+?)\s*\(Property:\s*(\d+)\)/);
  if (projectMatch) {
    return {
      name: projectMatch[1].trim(),
      property_id: projectMatch[2],
    };
  }

  return undefined;
}

/**
 * Parse list links output
 */
function parseListOutput(output: string): ListLinksOutput {
  const result: ListLinksOutput = {
    search_console: {
      status: 'manual_check_required',
      message: 'Manual check required. The Admin API cannot list Search Console links.',
    },
    bigquery: [],
    channel_groups: [],
  };

  // Parse BigQuery links
  const bqSection = extractSection(output, 'BigQuery Export:', 'Channel Groups:');
  if (bqSection) {
    result.bigquery = parseBigQueryLinks(bqSection);
  }

  // Parse Channel Groups
  const channelSection = extractSection(output, 'Channel Groups:', null);
  if (channelSection) {
    result.channel_groups = parseChannelGroups(channelSection);
  }

  return result;
}

/**
 * Parse BigQuery links from section
 */
function parseBigQueryLinks(section: string): BigQueryLinkInfo[] {
  const links: BigQueryLinkInfo[] = [];

  // Match pattern: "Project: project-id" followed by "Daily: true/false, Streaming: true/false"
  const projectMatches = section.matchAll(/Project:\s*([^\n]+)/g);

  for (const match of projectMatches) {
    const projectLine = match[0];
    const projectId = match[1].trim();

    // Find the next line with Daily/Streaming info
    const afterProject = section.substring(section.indexOf(projectLine) + projectLine.length);
    const dailyMatch = afterProject.match(/Daily:\s*(true|false)/);
    const streamingMatch = afterProject.match(/Streaming:\s*(true|false)/);

    links.push({
      name: `properties/*/bigQueryLinks/*`, // Full name not available in list output
      project: projectId,
      daily_export: dailyMatch ? dailyMatch[1] === 'true' : false,
      streaming_export: streamingMatch ? streamingMatch[1] === 'true' : false,
    });
  }

  return links;
}

/**
 * Parse channel groups from section
 */
function parseChannelGroups(section: string): ChannelGroupInfo[] {
  const groups: ChannelGroupInfo[] = [];

  // Match lines with checkmarks: "  name"
  const lines = section.split('\n');
  for (const line of lines) {
    // Match green checkmark pattern or similar
    const nameMatch = line.match(/[✓]\s+(.+)/);
    if (nameMatch) {
      const displayName = nameMatch[1].trim();
      groups.push({
        name: `properties/*/channelGroups/*`,
        display_name: displayName,
        system_defined: false, // User-created groups show here
      });
    }
  }

  return groups;
}

/**
 * Parse unlink operation output
 */
function parseUnlinkOutput(output: string, service: string): LinkOperationResult {
  const result: LinkOperationResult = {
    success: false,
    service,
    action: 'unlink',
    message: '',
  };

  // Check for success
  if (output.includes('Successfully deleted')) {
    result.success = true;
    result.message = `Successfully unlinked ${service}`;

    // Extract deleted items
    const deletedMatches = output.matchAll(/Successfully deleted\s+([^\n]+)/g);
    const deleted: string[] = [];
    for (const match of deletedMatches) {
      deleted.push(match[1].trim());
    }
    if (deleted.length > 0) {
      result.details = `Deleted: ${deleted.join(', ')}`;
    }
  } else if (output.includes('No') && output.includes('found to unlink')) {
    result.success = true;
    result.message = `No ${service} links found to unlink`;
  } else {
    result.message = `Unlink operation completed for ${service}`;
  }

  return result;
}

/**
 * Parse link service operation output
 */
function parseLinkServiceOutput(output: string, service: string): LinkOperationResult {
  const result: LinkOperationResult = {
    success: false,
    service,
    action: 'link',
    message: '',
  };

  switch (service) {
    case 'search-console':
      // Search Console returns a guide, not an actual link creation
      result.success = true;
      result.action = 'guide';
      result.message = 'Search Console setup guide generated';
      result.details = 'The GA4 Admin API does not support programmatic Search Console linking. Manual steps required.';
      break;

    case 'bigquery':
      if (output.includes('Successfully created BigQuery link')) {
        result.success = true;
        result.message = 'BigQuery link created successfully';
        const linkMatch = output.match(/Successfully created BigQuery link:\s*(.+)/);
        if (linkMatch) {
          result.details = linkMatch[1].trim();
        }
      } else if (output.includes('already exists')) {
        result.success = true;
        result.message = 'BigQuery link already exists';
      } else if (output.includes('could not create')) {
        result.success = false;
        result.message = 'Failed to create BigQuery link';
        const errorMatch = output.match(/could not create BigQuery link:\s*(.+)/);
        if (errorMatch) {
          result.details = errorMatch[1].trim();
        }
      }
      break;

    case 'channels':
      if (output.includes('Channel group setup process completed')) {
        result.success = true;
        result.message = 'Channel groups setup completed';
      } else if (output.includes('error occurred during channel group setup')) {
        result.success = false;
        result.message = 'Channel group setup failed';
        const errorMatch = output.match(/error occurred.*?:\s*(.+)/);
        if (errorMatch) {
          result.details = errorMatch[1].trim();
        }
      }
      break;
  }

  return result;
}

/**
 * Extract a section between two markers
 */
function extractSection(output: string, startMarker: string, endMarker: string | null): string | null {
  const startIdx = output.indexOf(startMarker);
  if (startIdx === -1) return null;

  if (endMarker === null) {
    return output.slice(startIdx);
  }

  const endIdx = output.indexOf(endMarker, startIdx);
  return endIdx === -1
    ? output.slice(startIdx)
    : output.slice(startIdx, endIdx);
}

/**
 * MCP Tool definition for ga4_link
 */
export const ga4LinkTool = {
  name: 'ga4_link',
  description: 'Link external services to GA4 property (Search Console, BigQuery, Channel Groups)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_name: {
        type: 'string',
        description: 'Config file name (without .yaml) - required',
      },
      service: {
        type: 'string',
        enum: ['search-console', 'bigquery', 'channels'],
        description: 'Service to link',
      },
      url: {
        type: 'string',
        description: 'Site URL (required for search-console)',
      },
      gcp_project: {
        type: 'string',
        description: 'GCP Project ID (required for bigquery)',
      },
      dataset: {
        type: 'string',
        description: 'BigQuery dataset ID (required for bigquery)',
      },
      list: {
        type: 'boolean',
        description: 'List existing links for all services',
      },
      unlink: {
        type: 'string',
        enum: ['bigquery', 'channels'],
        description: 'Service to unlink (removes existing link)',
      },
    },
    required: ['project_name'] as const,
  },
};
