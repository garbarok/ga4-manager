import { describe, it, expect } from 'vitest';
import {
  gscIndexCoverageInputSchema,
  gscIndexCoverageTool,
  buildIndexCoverageArgs,
  parseIndexCoverageOutput,
  VALID_STATES,
  VALID_FORMATS,
  GscIndexCoverageInput,
} from './gsc-coverage.js';

// ============================================================================
// Input Schema Validation Tests
// ============================================================================

describe('gsc_index_coverage input schema', () => {
  describe('site parameter', () => {
    it('accepts valid domain property site', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid URL prefix site', () => {
      const input = { site: 'https://example.com/' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts site with all optional parameters', () => {
      const input = {
        site: 'sc-domain:example.com',
        days: 7,
        state: 'indexed' as const,
        top_issues: 5,
        format: 'csv' as const,
        dry_run: true,
      };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('config parameter', () => {
    it('accepts valid config path', () => {
      const input = { config: '/path/to/config.yaml' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts config with optional parameters', () => {
      const input = {
        config: 'configs/mysite.yaml',
        days: 14,
        format: 'markdown' as const,
      };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('missing required parameters', () => {
    it('rejects empty input', () => {
      const input = {};
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects input with only optional parameters', () => {
      const input = { days: 30, format: 'json' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('days parameter validation', () => {
    it('accepts minimum days (1)', () => {
      const input = { site: 'sc-domain:example.com', days: 1 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts maximum days (180)', () => {
      const input = { site: 'sc-domain:example.com', days: 180 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects days below minimum', () => {
      const input = { site: 'sc-domain:example.com', days: 0 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects days above maximum', () => {
      const input = { site: 'sc-domain:example.com', days: 181 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer days', () => {
      const input = { site: 'sc-domain:example.com', days: 7.5 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('state parameter validation', () => {
    it.each(VALID_STATES)('accepts valid state: %s', (state) => {
      const input = { site: 'sc-domain:example.com', state };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid state', () => {
      const input = { site: 'sc-domain:example.com', state: 'invalid' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('top_issues parameter validation', () => {
    it('accepts minimum top_issues (1)', () => {
      const input = { site: 'sc-domain:example.com', top_issues: 1 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts maximum top_issues (50)', () => {
      const input = { site: 'sc-domain:example.com', top_issues: 50 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects top_issues below minimum', () => {
      const input = { site: 'sc-domain:example.com', top_issues: 0 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects top_issues above maximum', () => {
      const input = { site: 'sc-domain:example.com', top_issues: 51 };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('format parameter validation', () => {
    it.each(VALID_FORMATS)('accepts valid format: %s', (format) => {
      const input = { site: 'sc-domain:example.com', format };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid format', () => {
      const input = { site: 'sc-domain:example.com', format: 'xml' };
      const result = gscIndexCoverageInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Build Args Tests
// ============================================================================

describe('buildIndexCoverageArgs', () => {
  it('builds args with site only', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com' } as GscIndexCoverageInput);
    expect(args).toEqual(['gsc', 'coverage', '--site', 'sc-domain:example.com']);
  });

  it('builds args with config only', () => {
    const args = buildIndexCoverageArgs({ config: 'configs/mysite.yaml' } as GscIndexCoverageInput);
    expect(args).toEqual(['gsc', 'coverage', '--config', 'configs/mysite.yaml']);
  });

  it('builds args with custom days', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', days: 7 } as GscIndexCoverageInput);
    expect(args).toContain('--days');
    expect(args).toContain('7');
  });

  it('omits default days value (30)', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', days: 30 } as GscIndexCoverageInput);
    expect(args).not.toContain('--days');
  });

  it('builds args with custom state', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', state: 'indexed' } as GscIndexCoverageInput);
    expect(args).toContain('--state');
    expect(args).toContain('indexed');
  });

  it('omits default state (all)', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', state: 'all' } as GscIndexCoverageInput);
    expect(args).not.toContain('--state');
  });

  it('builds args with custom top_issues', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', top_issues: 5 } as GscIndexCoverageInput);
    expect(args).toContain('--top-issues');
    expect(args).toContain('5');
  });

  it('omits default top_issues (10)', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', top_issues: 10 } as GscIndexCoverageInput);
    expect(args).not.toContain('--top-issues');
  });

  it('builds args with custom format', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', format: 'csv' } as GscIndexCoverageInput);
    expect(args).toContain('--format');
    expect(args).toContain('csv');
  });

  it('omits default format (json)', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', format: 'json' } as GscIndexCoverageInput);
    expect(args).not.toContain('--format');
  });

  it('builds args with dry-run flag', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', dry_run: true } as GscIndexCoverageInput);
    expect(args).toContain('--dry-run');
  });

  it('omits dry-run when false', () => {
    const args = buildIndexCoverageArgs({ site: 'sc-domain:example.com', dry_run: false } as GscIndexCoverageInput);
    expect(args).not.toContain('--dry-run');
  });

  it('builds args with all options', () => {
    const input: GscIndexCoverageInput = {
      site: 'sc-domain:example.com',
      days: 14,
      state: 'low_impressions',
      top_issues: 5,
      format: 'markdown',
      dry_run: true,
    };
    const args = buildIndexCoverageArgs(input);
    expect(args).toContain('--site');
    expect(args).toContain('--days');
    expect(args).toContain('--state');
    expect(args).toContain('--top-issues');
    expect(args).toContain('--format');
    expect(args).toContain('--dry-run');
  });
});

// ============================================================================
// Parse Output Tests - Dry Run
// ============================================================================

describe('parseIndexCoverageOutput - dry run', () => {
  it('parses dry-run output with basic parameters', () => {
    const output = `
Dry-run mode - Preview of coverage report query

Site URL:     sc-domain:example.com
Date Range:   2024-01-01 to 2024-01-30
State Filter: all
Top Issues:   10

Query Details:
  - Will query Search Analytics with 'page' dimension
  - Maximum 25,000 pages will be analyzed
  - Pages categorized by impression count
  - Results are estimates based on search performance

No API call made. Remove --dry-run to execute query.
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('index_coverage');
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.dry_run).toBeDefined();
    expect(result.dry_run?.site_url).toBe('sc-domain:example.com');
    expect(result.dry_run?.state_filter).toBe('all');
    expect(result.dry_run?.top_issues_limit).toBe(10);
  });
});

// ============================================================================
// Parse Output Tests - JSON Format
// ============================================================================

describe('parseIndexCoverageOutput - JSON format', () => {
  it('parses successful JSON output with full data', () => {
    const output = `
{
  "SiteURL": "sc-domain:example.com",
  "Period": "2024-01-01 to 2024-01-30",
  "TotalPages": 500,
  "IndexedPages": 450,
  "IssueBreakdown": {
    "Indexed": 450,
    "Low impressions (< 10)": 40,
    "No impressions": 10
  },
  "TopIssues": [
    {
      "Issue": "Indexed",
      "Count": 450
    },
    {
      "Issue": "Low impressions (< 10)",
      "Count": 40
    },
    {
      "Issue": "No impressions",
      "Count": 10
    }
  ],
  "PagesSample": [
    {
      "URL": "https://example.com/page1",
      "Impressions": 1000,
      "Clicks": 50,
      "CTR": 0.05,
      "Position": 3.5,
      "Status": "indexed"
    },
    {
      "URL": "https://example.com/page2",
      "Impressions": 5,
      "Clicks": 0,
      "CTR": 0,
      "Position": 25.2,
      "Status": "low_impressions"
    }
  ]
}`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.total_pages).toBe(500);
    expect(result.indexed_pages).toBe(450);
    expect(result.indexed_percentage).toBe(90);
    expect(result.issue_breakdown).toMatchObject({
      'Indexed': 450,
      'Low impressions (< 10)': 40,
      'No impressions': 10,
    });
    expect(result.top_issues).toHaveLength(3);
    expect(result.top_issues?.[0]).toMatchObject({
      issue: 'Indexed',
      count: 450,
    });
    expect(result.pages_sample).toHaveLength(2);
    expect(result.pages_sample?.[0]).toMatchObject({
      url: 'https://example.com/page1',
      impressions: 1000,
      clicks: 50,
      status: 'indexed',
    });
  });

  it('parses JSON output with snake_case keys', () => {
    const output = `
{
  "site_url": "sc-domain:example.com",
  "period": "2024-01-01 to 2024-01-30",
  "total_pages": 100,
  "indexed_pages": 90,
  "issue_breakdown": {
    "Indexed": 90,
    "Low impressions": 10
  },
  "top_issues": [
    {
      "issue": "Indexed",
      "count": 90
    }
  ],
  "pages_sample": [
    {
      "url": "https://example.com/test",
      "impressions": 100,
      "clicks": 5,
      "ctr": 0.05,
      "position": 4.0,
      "status": "indexed"
    }
  ]
}`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.total_pages).toBe(100);
    expect(result.indexed_pages).toBe(90);
    expect(result.indexed_percentage).toBe(90);
    expect(result.top_issues?.[0].issue).toBe('Indexed');
    expect(result.pages_sample?.[0].url).toBe('https://example.com/test');
  });

  it('handles JSON output with no data', () => {
    const output = `
{
  "SiteURL": "sc-domain:example.com",
  "Period": "2024-01-01 to 2024-01-30",
  "TotalPages": 0,
  "IndexedPages": 0,
  "IssueBreakdown": {},
  "TopIssues": [],
  "PagesSample": []
}`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(true);
    expect(result.total_pages).toBe(0);
    expect(result.indexed_pages).toBe(0);
    expect(result.top_issues).toHaveLength(0);
    expect(result.pages_sample).toHaveLength(0);
  });
});

// ============================================================================
// Parse Output Tests - Table/Markdown Format
// ============================================================================

describe('parseIndexCoverageOutput - table format', () => {
  it('parses table output with summary section', () => {
    const output = `
Generating index coverage report for sc-domain:example.com...
Analyzing last 30 days (2024-01-01 to 2024-01-30)

=== Index Coverage Summary ===
Total Pages Found:    500
Indexed Pages:        450
Indexed Percentage:   90.0%

=== Coverage Issues ===
Issue Type                  | Count | Percentage
Indexed                     | 450   | 90.0%
Low impressions (< 10)      | 40    | 8.0%
No impressions              | 10    | 2.0%

=== Coverage Report Summary ===
Site:           sc-domain:example.com
Period:         2024-01-01 to 2024-01-30
Total Pages:    500
Indexed Pages:  450
Indexed %:      90.0%
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.total_pages).toBe(500);
    expect(result.indexed_pages).toBe(450);
    expect(result.indexed_percentage).toBe(90.0);
    // Table parsing extracts some issues (primary format is JSON)
    expect(result.top_issues).toBeDefined();
    expect(result.top_issues!.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Parse Output Tests - Error Handling
// ============================================================================

describe('parseIndexCoverageOutput - errors', () => {
  it('handles validation error', () => {
    const output = `
Validation failed: days must be between 1 and 180, got 200
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('days must be between 1 and 180');
  });

  it('handles missing site/config error', () => {
    const output = `
Either --site or --config must be provided
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Either --site or --config must be provided');
  });

  it('handles client creation error', () => {
    const output = `
Failed to create GSC client: credentials not found
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials not found');
  });

  it('handles coverage report error', () => {
    const output = `
Failed to generate coverage report: site not verified
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('site not verified');
  });

  it('handles config loading error', () => {
    const output = `
Failed to load config: file not found
`;

    const result = parseIndexCoverageOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('file not found');
  });
});

// ============================================================================
// Tool Definition Tests
// ============================================================================

describe('gscIndexCoverageTool definition', () => {
  it('has correct tool name', () => {
    expect(gscIndexCoverageTool.name).toBe('gsc_index_coverage');
  });

  it('has descriptive description', () => {
    expect(gscIndexCoverageTool.description).toContain('index coverage');
    expect(gscIndexCoverageTool.description).toContain('indexing status');
  });

  it('has proper input schema with required fields', () => {
    expect(gscIndexCoverageTool.inputSchema.type).toBe('object');
    expect(gscIndexCoverageTool.inputSchema.properties.site).toBeDefined();
    expect(gscIndexCoverageTool.inputSchema.properties.config).toBeDefined();
  });

  it('defines all optional parameters', () => {
    const props = gscIndexCoverageTool.inputSchema.properties;
    expect(props.days).toBeDefined();
    expect(props.state).toBeDefined();
    expect(props.top_issues).toBeDefined();
    expect(props.format).toBeDefined();
    expect(props.dry_run).toBeDefined();
  });
});
