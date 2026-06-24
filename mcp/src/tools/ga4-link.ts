import { z } from 'zod';

/**
 * ga4_link is split into three operation-specific tools so that a single
 * tool never mixes safe (read) and unsafe (write/delete) operations:
 *
 * - ga4_link_list   — read existing links (safe)
 * - ga4_link_create — create a BigQuery/Channels link or SC guide (write)
 * - ga4_link_remove — unlink an existing BigQuery/Channels link (destructive)
 *
 * All three dispatch to the same `ga4 link` CLI subcommand with different
 * flags, so the Go CLI is unchanged.
 */

// ── Input schemas ────────────────────────────────────────────────────────────

/** List existing links for all services. */
export const ga4LinkListInputSchema = z.object({
  /** Config file name (without .yaml) */
  project_name: z.string(),
});
export type GA4LinkListInput = z.infer<typeof ga4LinkListInputSchema>;

/** Create/manage a link for one service. */
export const ga4LinkCreateInputSchema = z
  .object({
    /** Config file name (without .yaml) */
    project_name: z.string(),
    /** Service to link */
    service: z.enum(['search-console', 'bigquery', 'channels']),
    /** Site URL for Search Console linking */
    url: z.string().optional(),
    /** GCP Project ID for BigQuery linking */
    gcp_project: z.string().optional(),
    /** BigQuery dataset ID */
    dataset: z.string().optional(),
  })
  .refine((data) => data.service !== 'search-console' || !!data.url, {
    error: 'url is required when service is search-console',
  })
  .refine((data) => data.service !== 'bigquery' || (!!data.gcp_project && !!data.dataset), {
    error: 'gcp_project and dataset are required when service is bigquery',
  });
export type GA4LinkCreateInput = z.infer<typeof ga4LinkCreateInputSchema>;

/** Unlink an existing link. Search Console links cannot be removed via the API. */
export const ga4LinkRemoveInputSchema = z.object({
  /** Config file name (without .yaml) */
  project_name: z.string(),
  /** Service to unlink */
  service: z.enum(['bigquery', 'channels']),
});
export type GA4LinkRemoveInput = z.infer<typeof ga4LinkRemoveInputSchema>;

// ── Output types ─────────────────────────────────────────────────────────────

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

// ── Build CLI arguments ──────────────────────────────────────────────────────

export function buildLinkListArgs(input: GA4LinkListInput): string[] {
  return ['--project', input.project_name, '--list'];
}

export function buildLinkCreateArgs(input: GA4LinkCreateInput): string[] {
  const args: string[] = ['--project', input.project_name, '--service', input.service];

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

  return args;
}

export function buildLinkRemoveArgs(input: GA4LinkRemoveInput): string[] {
  return ['--project', input.project_name, '--unlink', input.service];
}

// ── Parse CLI output ─────────────────────────────────────────────────────────

/** Shared prelude: detect a top-level error, else extract project info. */
function startResult(output: string, action: LinkOutput['action']): LinkOutput {
  const result: LinkOutput = { success: true, operation: 'link', action };
  const errorMatch = output.match(/Error:\s*(.+)/);
  if (errorMatch) {
    result.success = false;
    result.error = errorMatch[1].trim();
    return result;
  }
  result.project = extractProjectInfo(output);
  return result;
}

export function parseLinkListOutput(output: string): LinkOutput {
  const result = startResult(output, 'list');
  if (!result.success) return result;
  result.results = parseListOutput(output);
  return result;
}

export function parseLinkCreateOutput(output: string, service: GA4LinkCreateInput['service']): LinkOutput {
  const result = startResult(output, 'link');
  if (!result.success) return result;
  result.results = parseLinkServiceOutput(output, service);
  return result;
}

export function parseLinkRemoveOutput(output: string, service: GA4LinkRemoveInput['service']): LinkOutput {
  const result = startResult(output, 'unlink');
  if (!result.success) return result;
  result.results = parseUnlinkOutput(output, service);
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

// ── MCP tool definitions ─────────────────────────────────────────────────────

export const ga4LinkListTool = {
  name: 'ga4_link_list',
  description:
    'List existing external-service links for a GA4 property: BigQuery export links and custom Channel Groups. ' +
    '(Search Console links cannot be listed via the GA4 Admin API and are reported as requiring a manual check.)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_name: {
        type: 'string',
        description: 'Config file name (without .yaml) - required',
      },
    },
    required: ['project_name'] as const,
  },
  annotations: {
    title: 'List GA4 service links',
    readOnlyHint: true,
  },
};

export const ga4LinkCreateTool = {
  name: 'ga4_link_create',
  description:
    'Create an external-service link for a GA4 property. service=bigquery creates a BigQuery export link ' +
    '(requires gcp_project + dataset); service=channels sets up default Channel Groups; ' +
    'service=search-console returns a manual setup guide (the Admin API cannot link Search Console programmatically).',
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
    },
    required: ['project_name', 'service'] as const,
  },
  annotations: {
    title: 'Create GA4 service link',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
};

export const ga4LinkRemoveTool = {
  name: 'ga4_link_remove',
  description:
    'Remove (unlink) an existing external-service link from a GA4 property. ' +
    'service=bigquery deletes the BigQuery export link; service=channels removes custom Channel Groups. ' +
    'Search Console links cannot be removed via the Admin API.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      project_name: {
        type: 'string',
        description: 'Config file name (without .yaml) - required',
      },
      service: {
        type: 'string',
        enum: ['bigquery', 'channels'],
        description: 'Service to unlink (removes existing link)',
      },
    },
    required: ['project_name', 'service'] as const,
  },
  annotations: {
    title: 'Remove GA4 service link',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
};
