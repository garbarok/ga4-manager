import { z } from 'zod';

// ============================================================================
// GSC URL Inspect Tool
// ============================================================================

/**
 * Input schema for gsc_inspect_url tool
 */
export const gscInspectUrlInputSchema = z.object({
  /** Site URL: domain property (sc-domain:example.com) or URL prefix (https://example.com/) */
  site: z.string().min(1, 'Site URL is required'),
  /** URL to inspect (must be http or https) */
  url: z.string().min(1, 'URL to inspect is required'),
});

export type GscInspectUrlInput = z.infer<typeof gscInspectUrlInputSchema>;

/**
 * Indexing issue from URL inspection
 */
export interface IndexingIssue {
  severity: 'ERROR' | 'WARNING';
  issue_type: string;
  message: string;
}

/**
 * Quota status for URL inspection API
 */
export interface InspectQuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  date?: string;
  warning?: string;
}

/**
 * URL inspection result output structure
 */
export interface InspectUrlOutput {
  success: boolean;
  operation: 'inspect_url';
  url?: string;
  verdict?: 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';
  coverage_state?: string;
  last_crawl?: string;
  google_canonical?: string;
  user_canonical?: string;
  indexing_allowed?: boolean;
  robots_blocked?: boolean;
  mobile_usability?: 'PASS' | 'FAIL';
  mobile_issues?: string[];
  rich_results_status?: 'PASS' | 'FAIL';
  rich_results_issues?: string[];
  issues: IndexingIssue[];
  quota?: InspectQuotaStatus;
  error?: string;
}

/**
 * Build CLI arguments for URL inspection
 */
export function buildInspectUrlArgs(input: GscInspectUrlInput): string[] {
  return ['gsc', 'inspect', 'url', '--site', input.site, '--url', input.url];
}

/**
 * Parse verdict from index status line
 */
function parseVerdict(output: string): 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL' | undefined {
  // Check for different verdict indicators
  if (output.includes('Indexed (PASS)') || /✓\s*Indexed\s*\(PASS\)/.test(output)) {
    return 'PASS';
  }
  if (output.includes('Partially Indexed (PARTIAL)') || /⚠\s*Partially Indexed\s*\(PARTIAL\)/.test(output)) {
    return 'PARTIAL';
  }
  if (output.includes('Not Indexed (FAIL)') || /✗\s*Not Indexed\s*\(FAIL\)/.test(output)) {
    return 'FAIL';
  }
  if (output.includes('(NEUTRAL)')) {
    return 'NEUTRAL';
  }

  // Direct status pattern matching
  const statusMatch = output.match(/Status:\s*(PASS|PARTIAL|FAIL|NEUTRAL)/);
  if (statusMatch) {
    return statusMatch[1] as 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';
  }

  return undefined;
}

/**
 * Parse mobile usability verdict
 */
function parseMobileUsability(output: string): 'PASS' | 'FAIL' | undefined {
  // Check for "Not Mobile Usable" first (more specific pattern)
  if (output.includes('Not Mobile Usable') || /✗\s*Not Mobile Usable/.test(output)) {
    return 'FAIL';
  }
  // Then check for positive "Mobile Usable" (less specific pattern)
  if (output.includes('Mobile Usable') || /✓\s*Mobile Usable/.test(output)) {
    return 'PASS';
  }
  return undefined;
}

/**
 * Parse issues from the issues table
 */
function parseIssues(output: string): IndexingIssue[] {
  const issues: IndexingIssue[] = [];

  // Match table rows: | SEVERITY | ISSUE TYPE | MESSAGE |
  const tableRowRegex = /\|\s*(ERROR|WARNING)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g;

  let match;
  while ((match = tableRowRegex.exec(output)) !== null) {
    issues.push({
      severity: match[1].trim() as 'ERROR' | 'WARNING',
      issue_type: match[2].trim(),
      message: match[3].trim(),
    });
  }

  return issues;
}

/**
 * Parse mobile issues from output
 */
function parseMobileIssues(output: string): string[] {
  const issues: string[] = [];

  // Look for Mobile Issues section
  const mobileSection = output.match(/Mobile Issues:\s*([\s\S]*?)(?=\n\n|Rich Results:|Issues Found:|$)/);
  if (mobileSection) {
    const issueLines = mobileSection[1].match(/-\s*(.+)/g);
    if (issueLines) {
      for (const line of issueLines) {
        const issueMatch = line.match(/-\s*(.+)/);
        if (issueMatch) {
          issues.push(issueMatch[1].trim());
        }
      }
    }
  }

  return issues;
}

/**
 * Parse rich results issues from output
 */
function parseRichResultsIssues(output: string): string[] {
  const issues: string[] = [];

  // Look for Rich Results Issues section
  const richSection = output.match(/Rich Results Issues:\s*([\s\S]*?)(?=\n\n|Issues Found:|$)/);
  if (richSection) {
    const issueLines = richSection[1].match(/-\s*(.+)/g);
    if (issueLines) {
      for (const line of issueLines) {
        const issueMatch = line.match(/-\s*(.+)/);
        if (issueMatch) {
          issues.push(issueMatch[1].trim());
        }
      }
    }
  }

  return issues;
}

/**
 * Parse quota status from output
 */
function parseQuotaStatus(output: string): InspectQuotaStatus | undefined {
  // Pattern: Inspections: X / Y (Z% used, N remaining)
  const quotaMatch = output.match(/Inspections:\s*(\d+)\s*\/\s*(\d+)\s*\([^)]+,\s*(\d+)\s*remaining\)/);
  if (quotaMatch) {
    const used = parseInt(quotaMatch[1], 10);
    const limit = parseInt(quotaMatch[2], 10);
    const remaining = parseInt(quotaMatch[3], 10);

    const quota: InspectQuotaStatus = {
      used,
      limit,
      remaining,
    };

    // Extract date if present
    const dateMatch = output.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      quota.date = dateMatch[1];
    }

    // Check for warnings
    if (output.includes('CRITICAL: Approaching daily limit')) {
      quota.warning = 'CRITICAL: Approaching daily limit';
    } else if (output.includes('WARNING:')) {
      const warningMatch = output.match(/WARNING:\s*([^\n]+)/);
      if (warningMatch) {
        quota.warning = warningMatch[1].trim();
      }
    }

    return quota;
  }

  return undefined;
}

/**
 * Parse CLI output for URL inspection
 */
export function parseInspectUrlOutput(output: string): InspectUrlOutput {
  const result: InspectUrlOutput = {
    success: true,
    operation: 'inspect_url',
    issues: [],
  };

  // Check for errors
  if (output.includes('Failed to inspect URL:')) {
    const errorMatch = output.match(/Failed to inspect URL:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Unknown error';
    return result;
  }

  if (output.includes('Failed to create GSC client:')) {
    const errorMatch = output.match(/Failed to create GSC client:\s*(.+)/);
    result.success = false;
    result.error = errorMatch ? errorMatch[1].trim() : 'Failed to create GSC client';
    return result;
  }

  // Check for quota exceeded
  if (output.includes('daily quota critical threshold reached')) {
    result.success = false;
    result.error = 'Daily quota critical threshold reached. Please wait until tomorrow to continue.';
    return result;
  }

  // Extract URL
  const urlMatch = output.match(/URL:\s*(https?:\/\/[^\s\n]+)/);
  if (urlMatch) {
    result.url = urlMatch[1].trim();
  }

  // Extract verdict/index status
  result.verdict = parseVerdict(output);

  // Extract coverage state
  const coverageMatch = output.match(/Coverage:\s*(.+)/);
  if (coverageMatch) {
    result.coverage_state = coverageMatch[1].trim();
  }

  // Extract last crawl time
  const crawlMatch = output.match(/Last Crawl:\s*(.+)/);
  if (crawlMatch) {
    result.last_crawl = crawlMatch[1].trim();
  }

  // Extract Google canonical URL
  const googleCanonicalMatch = output.match(/Google Canonical:\s*(https?:\/\/[^\s\n]+)/);
  if (googleCanonicalMatch) {
    result.google_canonical = googleCanonicalMatch[1].trim();
  }

  // Extract user canonical URL
  const userCanonicalMatch = output.match(/User Canonical:\s*(https?:\/\/[^\s\n]+)/);
  if (userCanonicalMatch) {
    result.user_canonical = userCanonicalMatch[1].trim();
  }

  // Extract indexing allowed status
  if (output.includes('Indexing Allowed') || /✓\s*Indexing Allowed/.test(output)) {
    result.indexing_allowed = true;
  } else if (output.includes('Indexing Not Allowed') || /✗\s*Indexing Not Allowed/.test(output)) {
    result.indexing_allowed = false;
  }

  // Extract robots blocked status
  if (output.includes('Blocked by robots.txt') || /✗\s*Blocked by robots\.txt/.test(output)) {
    result.robots_blocked = true;
  } else {
    result.robots_blocked = false;
  }

  // Extract mobile usability
  result.mobile_usability = parseMobileUsability(output);

  // Extract mobile issues
  const mobileIssues = parseMobileIssues(output);
  if (mobileIssues.length > 0) {
    result.mobile_issues = mobileIssues;
  }

  // Extract rich results status
  if (output.includes('Rich Results:')) {
    if (output.includes('Valid (PASS)') || /✓\s*Valid\s*\(PASS\)/.test(output)) {
      result.rich_results_status = 'PASS';
    } else if (output.includes('Invalid (FAIL)') || /✗\s*Invalid\s*\(FAIL\)/.test(output)) {
      result.rich_results_status = 'FAIL';
    }
  }

  // Extract rich results issues
  const richIssues = parseRichResultsIssues(output);
  if (richIssues.length > 0) {
    result.rich_results_issues = richIssues;
  }

  // Parse indexing issues from table
  result.issues = parseIssues(output);

  // Parse quota status
  result.quota = parseQuotaStatus(output);

  return result;
}

/**
 * MCP Tool definition for gsc_inspect_url
 */
export const gscInspectUrlTool = {
  name: 'gsc_inspect_url',
  description:
    'Inspect URL indexing status in Google Search Console. Shows whether a URL is indexed, coverage state, crawl info, mobile usability, rich results, and any indexing issues. Rate limits: 2,000 inspections/day, 600/minute per property.',
  inputSchema: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description:
          'Site URL: domain property (sc-domain:example.com - RECOMMENDED) or URL prefix (https://example.com/)',
      },
      url: {
        type: 'string',
        description: 'URL to inspect (e.g., https://example.com/page)',
      },
    },
    required: ['site', 'url'],
  },
};

// ============================================================================
// Exports
// ============================================================================

export const gscInspectTools = [gscInspectUrlTool] as const;
