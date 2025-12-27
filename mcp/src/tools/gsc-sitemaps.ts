import { z } from 'zod';

// ============================================================================
// GSC Sitemaps List Tool
// ============================================================================

/**
 * Input schema for gsc_sitemaps_list tool
 */
export const gscSitemapsListInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().min(1, 'Site URL is required'),
});

export type GscSitemapsListInput = z.infer<typeof gscSitemapsListInputSchema>;

/**
 * Sitemap information from list output
 */
export interface SitemapInfo {
  url: string;
  urls_count: number;
  errors: number;
  warnings: number;
  last_submitted?: string;
  status: string;
  is_index?: boolean;
  is_pending?: boolean;
}

/**
 * List sitemaps output structure
 */
export interface SitemapsListOutput {
  success: boolean;
  operation: 'list';
  site?: string;
  sitemaps: SitemapInfo[];
  error?: string;
}

/**
 * Build CLI arguments for sitemaps list
 */
export function buildSitemapsListArgs(input: GscSitemapsListInput): string[] {
  return ['gsc', 'sitemaps', 'list', '--site', input.site];
}

/**
 * Parse CLI output for sitemaps list
 */
export function parseSitemapsListOutput(output: string): SitemapsListOutput {
  const result: SitemapsListOutput = {
    success: true,
    operation: 'list',
    sitemaps: [],
  };

  // Check for errors
  if (output.includes('Failed to list sitemaps:')) {
    const errorMatch = output.match(/Failed to list sitemaps:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Unknown error';
    return result;
  }

  // Extract site from output
  const siteMatch = output.match(/Listing sitemaps for\s+(.+)/);
  if (siteMatch) {
    result.site = siteMatch[1].trim();
  }

  // Check for no sitemaps
  if (output.includes('No sitemaps found')) {
    return result;
  }

  // Parse table rows - match URL patterns with optional (Index) suffix
  // Table format: | URL | URLS | ERRORS | WARNINGS | LAST SUBMITTED | STATUS |
  const tableRowRegex = /\|\s*(https?:\/\/[^\s|]+(?:\s*\(Index\))?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;

  let match;
  while ((match = tableRowRegex.exec(output)) !== null) {
    let url = match[1].trim();
    const isIndex = url.includes('(Index)');
    if (isIndex) {
      url = url.replace(/\s*\(Index\)/, '').trim();
    }

    const status = match[6].trim();
    const isPending = status.toLowerCase().includes('pending');

    const sitemap: SitemapInfo = {
      url,
      urls_count: parseInt(match[2], 10),
      errors: parseInt(match[3], 10),
      warnings: parseInt(match[4], 10),
      last_submitted: match[5].trim(),
      status,
      is_index: isIndex || undefined,
      is_pending: isPending || undefined,
    };

    result.sitemaps.push(sitemap);
  }

  return result;
}

/**
 * MCP Tool definition for gsc_sitemaps_list
 */
export const gscSitemapsListTool = {
  name: 'gsc_sitemaps_list',
  description: 'List all sitemaps for a Google Search Console site',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)',
      },
    },
    required: ['site'],
  },
};

// ============================================================================
// GSC Sitemaps Submit Tool
// ============================================================================

/**
 * Input schema for gsc_sitemaps_submit tool
 */
export const gscSitemapsSubmitInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().min(1, 'Site URL is required'),
  /** Sitemap URL to submit (e.g., https://example.com/sitemap.xml) */
  url: z.string().min(1, 'Sitemap URL is required'),
});

export type GscSitemapsSubmitInput = z.infer<typeof gscSitemapsSubmitInputSchema>;

/**
 * Submit sitemap output structure
 */
export interface SitemapsSubmitOutput {
  success: boolean;
  operation: 'submit';
  site?: string;
  sitemap_url?: string;
  error?: string;
}

/**
 * Build CLI arguments for sitemaps submit
 */
export function buildSitemapsSubmitArgs(input: GscSitemapsSubmitInput): string[] {
  return ['gsc', 'sitemaps', 'submit', '--site', input.site, '--url', input.url];
}

/**
 * Parse CLI output for sitemaps submit
 */
export function parseSitemapsSubmitOutput(output: string): SitemapsSubmitOutput {
  const result: SitemapsSubmitOutput = {
    success: true,
    operation: 'submit',
  };

  // Check for errors
  if (output.includes('Failed to submit sitemap:')) {
    const errorMatch = output.match(/Failed to submit sitemap:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Unknown error';
    return result;
  }

  // Extract site and sitemap URL
  const siteMatch = output.match(/Site:\s*(.+)/);
  if (siteMatch) {
    result.site = siteMatch[1].trim();
  }

  const sitemapMatch = output.match(/Sitemap:\s*(.+)/);
  if (sitemapMatch) {
    result.sitemap_url = sitemapMatch[1].trim();
  }

  // Verify success
  if (output.includes('submitted successfully')) {
    result.success = true;
  }

  return result;
}

/**
 * MCP Tool definition for gsc_sitemaps_submit
 */
export const gscSitemapsSubmitTool = {
  name: 'gsc_sitemaps_submit',
  description: 'Submit a sitemap URL to Google Search Console for crawling',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)',
      },
      url: {
        type: 'string',
        description: 'Sitemap URL to submit (e.g., https://example.com/sitemap.xml)',
      },
    },
    required: ['site', 'url'],
  },
};

// ============================================================================
// GSC Sitemaps Delete Tool
// ============================================================================

/**
 * Input schema for gsc_sitemaps_delete tool
 */
export const gscSitemapsDeleteInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().min(1, 'Site URL is required'),
  /** Sitemap URL to delete */
  url: z.string().min(1, 'Sitemap URL is required'),
});

export type GscSitemapsDeleteInput = z.infer<typeof gscSitemapsDeleteInputSchema>;

/**
 * Delete sitemap output structure
 */
export interface SitemapsDeleteOutput {
  success: boolean;
  operation: 'delete';
  site?: string;
  sitemap_url?: string;
  error?: string;
}

/**
 * Build CLI arguments for sitemaps delete
 */
export function buildSitemapsDeleteArgs(input: GscSitemapsDeleteInput): string[] {
  return ['gsc', 'sitemaps', 'delete', '--site', input.site, '--url', input.url];
}

/**
 * Parse CLI output for sitemaps delete
 */
export function parseSitemapsDeleteOutput(output: string): SitemapsDeleteOutput {
  const result: SitemapsDeleteOutput = {
    success: true,
    operation: 'delete',
  };

  // Check for errors
  if (output.includes('Failed to delete sitemap:')) {
    const errorMatch = output.match(/Failed to delete sitemap:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Unknown error';
    return result;
  }

  // Extract site and sitemap URL
  const siteMatch = output.match(/Site:\s*(.+)/);
  if (siteMatch) {
    result.site = siteMatch[1].trim();
  }

  const sitemapMatch = output.match(/Sitemap:\s*(.+)/);
  if (sitemapMatch) {
    result.sitemap_url = sitemapMatch[1].trim();
  }

  // Verify success
  if (output.includes('deleted successfully')) {
    result.success = true;
  }

  return result;
}

/**
 * MCP Tool definition for gsc_sitemaps_delete
 */
export const gscSitemapsDeleteTool = {
  name: 'gsc_sitemaps_delete',
  description: 'Delete a sitemap from Google Search Console (does not delete the file itself)',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)',
      },
      url: {
        type: 'string',
        description: 'Sitemap URL to delete',
      },
    },
    required: ['site', 'url'],
  },
};

// ============================================================================
// GSC Sitemaps Get Tool
// ============================================================================

/**
 * Input schema for gsc_sitemaps_get tool
 */
export const gscSitemapsGetInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().min(1, 'Site URL is required'),
  /** Sitemap URL to retrieve details for */
  url: z.string().min(1, 'Sitemap URL is required'),
});

export type GscSitemapsGetInput = z.infer<typeof gscSitemapsGetInputSchema>;

/**
 * Sitemap content breakdown
 */
export interface SitemapContent {
  type: string;
  submitted: number;
  indexed: number;
  indexed_percent?: number;
}

/**
 * Detailed sitemap information
 */
export interface SitemapDetails {
  url: string;
  type: string;
  is_index?: boolean;
  is_pending?: boolean;
  last_submitted?: string;
  last_downloaded?: string;
  errors: number;
  warnings: number;
  contents?: SitemapContent[];
}

/**
 * Get sitemap output structure
 */
export interface SitemapsGetOutput {
  success: boolean;
  operation: 'get';
  site?: string;
  sitemap?: SitemapDetails;
  error?: string;
}

/**
 * Build CLI arguments for sitemaps get
 */
export function buildSitemapsGetArgs(input: GscSitemapsGetInput): string[] {
  return ['gsc', 'sitemaps', 'get', '--site', input.site, '--url', input.url];
}

/**
 * Parse CLI output for sitemaps get
 */
export function parseSitemapsGetOutput(output: string): SitemapsGetOutput {
  const result: SitemapsGetOutput = {
    success: true,
    operation: 'get',
  };

  // Check for errors
  if (output.includes('Failed to get sitemap:')) {
    const errorMatch = output.match(/Failed to get sitemap:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Unknown error';
    return result;
  }

  const sitemap: SitemapDetails = {
    url: '',
    type: 'Regular Sitemap',
    errors: 0,
    warnings: 0,
  };

  // Extract URL
  const urlMatch = output.match(/URL:\s*(.+)/);
  if (urlMatch) {
    sitemap.url = urlMatch[1].trim();
  }

  // Extract type
  const typeMatch = output.match(/Type:\s*(.+)/);
  if (typeMatch) {
    sitemap.type = typeMatch[1].trim();
    sitemap.is_index = sitemap.type.toLowerCase().includes('index');
  }

  // Extract last submitted
  const lastSubmittedMatch = output.match(/Last Submitted:\s*(.+)/);
  if (lastSubmittedMatch) {
    sitemap.last_submitted = lastSubmittedMatch[1].trim();
  }

  // Extract last downloaded
  const lastDownloadedMatch = output.match(/Last Downloaded:\s*(.+)/);
  if (lastDownloadedMatch) {
    sitemap.last_downloaded = lastDownloadedMatch[1].trim();
  }

  // Extract status (pending check)
  const statusMatch = output.match(/Status:\s*(.+)/);
  if (statusMatch) {
    sitemap.is_pending = statusMatch[1].toLowerCase().includes('pending');
  }

  // Extract errors
  const errorsMatch = output.match(/Errors:\s*(\d+)/);
  if (errorsMatch) {
    sitemap.errors = parseInt(errorsMatch[1], 10);
  }

  // Extract warnings
  const warningsMatch = output.match(/Warnings:\s*(\d+)/);
  if (warningsMatch) {
    sitemap.warnings = parseInt(warningsMatch[1], 10);
  }

  // Parse content breakdown table
  // Table format: | TYPE | SUBMITTED | INDEXED |
  const contentRowRegex = /\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\([^)]+\)\s*\|/g;
  const contents: SitemapContent[] = [];
  let contentMatch;
  while ((contentMatch = contentRowRegex.exec(output)) !== null) {
    const submitted = parseInt(contentMatch[2], 10);
    const indexed = parseInt(contentMatch[3], 10);
    contents.push({
      type: contentMatch[1].trim(),
      submitted,
      indexed,
      indexed_percent: submitted > 0 ? (indexed / submitted) * 100 : 0,
    });
  }

  if (contents.length > 0) {
    sitemap.contents = contents;
  }

  result.sitemap = sitemap;
  return result;
}

/**
 * MCP Tool definition for gsc_sitemaps_get
 */
export const gscSitemapsGetTool = {
  name: 'gsc_sitemaps_get',
  description: 'Get detailed information about a specific sitemap including status, errors, and content breakdown',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/)',
      },
      url: {
        type: 'string',
        description: 'Sitemap URL to retrieve details for',
      },
    },
    required: ['site', 'url'],
  },
};

// ============================================================================
// Exports
// ============================================================================

export const gscSitemapsTools = [
  gscSitemapsListTool,
  gscSitemapsSubmitTool,
  gscSitemapsDeleteTool,
  gscSitemapsGetTool,
] as const;
