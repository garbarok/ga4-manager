import { describe, it, expect } from 'vitest';
import {
  gscAnalyticsRunInputSchema,
  gscAnalyticsRunTool,
  buildAnalyticsRunArgs,
  parseAnalyticsRunOutput,
  validateDimensions,
  VALID_DIMENSIONS,
  VALID_FORMATS,
  GscAnalyticsRunInput,
} from './gsc-analytics';

// ============================================================================
// Input Schema Validation Tests
// ============================================================================

describe('gsc_analytics_run input schema', () => {
  describe('site parameter', () => {
    it('accepts valid domain property site', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid URL prefix site', () => {
      const input = { site: 'https://example.com/' };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts site with all optional parameters', () => {
      const input = {
        site: 'sc-domain:example.com',
        days: 7,
        dimensions: 'query,page,country',
        limit: 500,
        format: 'csv' as const,
        dry_run: true,
      };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('config parameter', () => {
    it('accepts valid config path', () => {
      const input = { config: '/path/to/config.yaml' };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts config with optional parameters', () => {
      const input = {
        config: 'configs/mysite.yaml',
        days: 14,
        format: 'markdown' as const,
      };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('missing required parameters', () => {
    it('rejects empty input', () => {
      const input = {};
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects input with only optional parameters', () => {
      const input = { days: 30, format: 'json' };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('days parameter validation', () => {
    it('accepts minimum days (1)', () => {
      const input = { site: 'sc-domain:example.com', days: 1 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts maximum days (180)', () => {
      const input = { site: 'sc-domain:example.com', days: 180 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects days below minimum', () => {
      const input = { site: 'sc-domain:example.com', days: 0 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects days above maximum', () => {
      const input = { site: 'sc-domain:example.com', days: 181 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer days', () => {
      const input = { site: 'sc-domain:example.com', days: 7.5 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('limit parameter validation', () => {
    it('accepts minimum limit (1)', () => {
      const input = { site: 'sc-domain:example.com', limit: 1 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts maximum limit (25000)', () => {
      const input = { site: 'sc-domain:example.com', limit: 25000 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects limit below minimum', () => {
      const input = { site: 'sc-domain:example.com', limit: 0 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects limit above maximum', () => {
      const input = { site: 'sc-domain:example.com', limit: 25001 };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('format parameter validation', () => {
    it.each(VALID_FORMATS)('accepts valid format: %s', (format) => {
      const input = { site: 'sc-domain:example.com', format };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid format', () => {
      const input = { site: 'sc-domain:example.com', format: 'xml' };
      const result = gscAnalyticsRunInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Dimension Validation Tests
// ============================================================================

describe('validateDimensions', () => {
  it('validates single dimension', () => {
    const result = validateDimensions('query');
    expect(result.valid).toBe(true);
    expect(result.dimensions).toEqual(['query']);
    expect(result.errors).toHaveLength(0);
  });

  it('validates multiple valid dimensions', () => {
    const result = validateDimensions('query,page,country');
    expect(result.valid).toBe(true);
    expect(result.dimensions).toEqual(['query', 'page', 'country']);
  });

  it('trims whitespace from dimensions', () => {
    const result = validateDimensions('query , page , device');
    expect(result.valid).toBe(true);
    expect(result.dimensions).toEqual(['query', 'page', 'device']);
  });

  it('rejects empty dimension string', () => {
    const result = validateDimensions('');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least one dimension is required');
  });

  it('rejects more than 3 dimensions', () => {
    const result = validateDimensions('query,page,country,device');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Maximum 3 dimensions allowed');
  });

  it('rejects invalid dimension', () => {
    const result = validateDimensions('query,invalid,page');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid dimension(s): invalid');
  });

  it.each(VALID_DIMENSIONS)('accepts valid dimension: %s', (dim) => {
    const result = validateDimensions(dim);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Build Args Tests
// ============================================================================

describe('buildAnalyticsRunArgs', () => {
  it('builds args with site only', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com' } as GscAnalyticsRunInput);
    expect(args).toEqual(['gsc', 'analytics', 'run', '--site', 'sc-domain:example.com']);
  });

  it('builds args with config only', () => {
    const args = buildAnalyticsRunArgs({ config: 'configs/mysite.yaml' } as GscAnalyticsRunInput);
    expect(args).toEqual(['gsc', 'analytics', 'run', '--config', 'configs/mysite.yaml']);
  });

  it('builds args with custom days', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', days: 7 } as GscAnalyticsRunInput);
    expect(args).toContain('--days');
    expect(args).toContain('7');
  });

  it('omits default days value (30)', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', days: 30 } as GscAnalyticsRunInput);
    expect(args).not.toContain('--days');
  });

  it('builds args with custom dimensions', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', dimensions: 'query,device' } as GscAnalyticsRunInput);
    expect(args).toContain('--dimensions');
    expect(args).toContain('query,device');
  });

  it('omits default dimensions (query,page)', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', dimensions: 'query,page' } as GscAnalyticsRunInput);
    expect(args).not.toContain('--dimensions');
  });

  it('builds args with custom limit', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', limit: 500 } as GscAnalyticsRunInput);
    expect(args).toContain('--limit');
    expect(args).toContain('500');
  });

  it('omits default limit (100)', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', limit: 100 } as GscAnalyticsRunInput);
    expect(args).not.toContain('--limit');
  });

  it('builds args with custom format', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', format: 'csv' } as GscAnalyticsRunInput);
    expect(args).toContain('--format');
    expect(args).toContain('csv');
  });

  it('omits default format (json)', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', format: 'json' } as GscAnalyticsRunInput);
    expect(args).not.toContain('--format');
  });

  it('builds args with dry-run flag', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', dry_run: true } as GscAnalyticsRunInput);
    expect(args).toContain('--dry-run');
  });

  it('omits dry-run when false', () => {
    const args = buildAnalyticsRunArgs({ site: 'sc-domain:example.com', dry_run: false } as GscAnalyticsRunInput);
    expect(args).not.toContain('--dry-run');
  });

  it('builds args with all options', () => {
    const input: GscAnalyticsRunInput = {
      site: 'sc-domain:example.com',
      days: 14,
      dimensions: 'query,country',
      limit: 200,
      format: 'markdown',
      dry_run: true,
    };
    const args = buildAnalyticsRunArgs(input);
    expect(args).toContain('--site');
    expect(args).toContain('--days');
    expect(args).toContain('--dimensions');
    expect(args).toContain('--limit');
    expect(args).toContain('--format');
    expect(args).toContain('--dry-run');
  });
});

// ============================================================================
// Parse Output Tests - Dry Run
// ============================================================================

describe('parseAnalyticsRunOutput - dry run', () => {
  it('parses dry-run output with basic parameters', () => {
    const output = `
Dry-run mode - Preview of search analytics query

Site URL:     sc-domain:example.com
Date Range:   2024-01-01 to 2024-01-30
Dimensions:   query, page
Row Limit:    100
Data State:   final

No API call made. Remove --dry-run to execute query.
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.operation).toBe('analytics');
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.dry_run).toBeDefined();
    expect(result.dry_run?.site_url).toBe('sc-domain:example.com');
    expect(result.dry_run?.dimensions).toEqual(['query', 'page']);
    expect(result.dry_run?.row_limit).toBe(100);
    expect(result.dry_run?.data_state).toBe('final');
  });

  it('parses dry-run output with filters', () => {
    const output = `
Dry-run mode - Preview of search analytics query

Site URL:     sc-domain:example.com
Date Range:   2024-01-01 to 2024-01-30
Dimensions:   query
Row Limit:    50
Data State:   final

Filters:
  1. query contains 'blog'
  2. page equals '/articles/'

No API call made. Remove --dry-run to execute query.
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.dry_run?.filters).toHaveLength(2);
    expect(result.dry_run?.filters?.[0]).toMatchObject({
      dimension: 'query',
      operator: 'contains',
      expression: 'blog',
    });
  });
});

// ============================================================================
// Parse Output Tests - JSON Format
// ============================================================================

describe('parseAnalyticsRunOutput - JSON format', () => {
  it('parses successful JSON output with full data', () => {
    const output = `
{
  "SiteURL": "sc-domain:example.com",
  "Period": "2024-01-01 to 2024-01-30",
  "TotalRows": 50,
  "Aggregates": {
    "TotalClicks": 1500,
    "TotalImpressions": 50000,
    "AverageCTR": 0.03,
    "AveragePosition": 15.5
  },
  "Rows": [
    {
      "Keys": ["best products", "https://example.com/products"],
      "Clicks": 100,
      "Impressions": 2000,
      "CTR": 0.05,
      "Position": 3.5
    },
    {
      "Keys": ["top reviews", "https://example.com/reviews"],
      "Clicks": 80,
      "Impressions": 1800,
      "CTR": 0.044,
      "Position": 5.2
    }
  ],
  "Metadata": {
    "QueryDate": "2024-02-01T10:30:00Z",
    "StartDate": "2024-01-01",
    "EndDate": "2024-01-30",
    "Dimensions": ["query", "page"],
    "RowLimit": 100,
    "FilterCount": 0
  }
}`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.total_rows).toBe(50);
    expect(result.aggregates).toMatchObject({
      total_clicks: 1500,
      total_impressions: 50000,
      average_ctr: 0.03,
      average_position: 15.5,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows?.[0]).toMatchObject({
      keys: ['best products', 'https://example.com/products'],
      clicks: 100,
      impressions: 2000,
    });
    expect(result.metadata).toMatchObject({
      start_date: '2024-01-01',
      end_date: '2024-01-30',
      dimensions: ['query', 'page'],
    });
  });

  it('parses JSON output with snake_case keys', () => {
    const output = `
{
  "site_url": "sc-domain:example.com",
  "period": "2024-01-01 to 2024-01-30",
  "total_rows": 10,
  "aggregates": {
    "total_clicks": 500,
    "total_impressions": 10000,
    "average_ctr": 0.05,
    "average_position": 8.3
  },
  "rows": [
    {
      "keys": ["test query"],
      "clicks": 50,
      "impressions": 1000,
      "ctr": 0.05,
      "position": 4.0
    }
  ]
}`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.total_rows).toBe(10);
    expect(result.aggregates?.total_clicks).toBe(500);
    expect(result.rows?.[0].clicks).toBe(50);
  });

  it('handles invalid JSON gracefully', () => {
    const output = `Some prefix text without valid JSON structure`;

    const result = parseAnalyticsRunOutput(output);

    // Since no JSON pattern found, it falls back to table parsing
    expect(result.success).toBe(true);
  });

  it('handles JSON output with no data', () => {
    const output = `
{
  "SiteURL": "sc-domain:example.com",
  "Period": "2024-01-01 to 2024-01-30",
  "TotalRows": 0,
  "Rows": [],
  "Aggregates": {
    "TotalClicks": 0,
    "TotalImpressions": 0,
    "AverageCTR": 0,
    "AveragePosition": 0
  }
}`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.total_rows).toBe(0);
    expect(result.rows).toHaveLength(0);
  });
});

// ============================================================================
// Parse Output Tests - Table/Markdown Format
// ============================================================================

describe('parseAnalyticsRunOutput - table format', () => {
  it('parses table output with summary section', () => {
    const output = `
Querying search analytics for sc-domain:example.com
Date range: 2024-01-01 to 2024-01-30 (30 days)
Dimensions: query, page

Query                           Page                             Clicks  Impressions  CTR      Position
best products                   https://example.com/products     100     2000         5.0%     3.5
top reviews                     https://example.com/reviews      80      1800         4.4%     5.2

=== Report Summary ===
Period:         2024-01-01 to 2024-01-30
Total Rows:     50
Total Clicks:   1500
Total Impressions: 50000
Average CTR:    3.00%
Avg Position:   15.5
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.site).toBe('sc-domain:example.com');
    expect(result.period).toBe('2024-01-01 to 2024-01-30');
    expect(result.total_rows).toBe(50);
    expect(result.aggregates).toMatchObject({
      total_clicks: 1500,
      total_impressions: 50000,
      average_ctr: 0.03,
      average_position: 15.5,
    });
  });

  it('parses no data response', () => {
    const output = `
Querying search analytics for sc-domain:example.com...
Date range: 2024-01-01 to 2024-01-30 (30 days)

No data found for this query
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.total_rows).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('parses output with quota status - healthy', () => {
    const output = `
Querying search analytics for sc-domain:example.com...

Total Rows:     50
Total Clicks:   1500
Total Impressions: 50000
Average CTR:    3.00%
Avg Position:   15.5

=== Daily Quota Status ===
Date:           2024-02-01
Queries Used:   150 / 2000 (7.5%)
Remaining:      1850
Quota usage healthy
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(true);
    expect(result.quota).toBeDefined();
    expect(result.quota?.queries_used).toBe(150);
    expect(result.quota?.queries_limit).toBe(2000);
    expect(result.quota?.remaining).toBe(1850);
    expect(result.quota?.percentage_used).toBe(7.5);
    expect(result.quota?.status).toBe('healthy');
  });

  it('parses output with quota status - warning', () => {
    const output = `
=== Daily Quota Status ===
Date:           2024-02-01
Queries Used:   1600 / 2000 (80.0%)
Remaining:      400
Quota usage warning
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.quota?.status).toBe('warning');
  });

  it('parses output with quota status - critical', () => {
    const output = `
=== Daily Quota Status ===
Date:           2024-02-01
Queries Used:   1950 / 2000 (97.5%)
Remaining:      50
Quota usage critical
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.quota?.status).toBe('critical');
  });
});

// ============================================================================
// Parse Output Tests - Error Handling
// ============================================================================

describe('parseAnalyticsRunOutput - errors', () => {
  it('handles validation error', () => {
    const output = `
Validation failed: days must be between 1 and 180, got 200
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('days must be between 1 and 180');
  });

  it('handles missing site/config error', () => {
    const output = `
Either --site or --config must be provided
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Either --site or --config must be provided');
  });

  it('handles client creation error', () => {
    const output = `
Failed to create GSC client: credentials not found
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials not found');
  });

  it('handles query execution error', () => {
    const output = `
Failed to query search analytics: site not verified
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('site not verified');
  });

  it('handles config loading error', () => {
    const output = `
Failed to load config: file not found
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('file not found');
  });

  it('handles missing search_console config', () => {
    const output = `
No search_console configuration found in configs/mysite.yaml
`;

    const result = parseAnalyticsRunOutput(output);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No search_console configuration found');
  });
});

// ============================================================================
// Tool Definition Tests
// ============================================================================

describe('gscAnalyticsRunTool definition', () => {
  it('has correct tool name', () => {
    expect(gscAnalyticsRunTool.name).toBe('gsc_analytics_run');
  });

  it('has descriptive description', () => {
    expect(gscAnalyticsRunTool.description).toContain('search analytics');
    expect(gscAnalyticsRunTool.description).toContain('Google Search Console');
  });

  it('has proper input schema with required fields', () => {
    expect(gscAnalyticsRunTool.inputSchema.type).toBe('object');
    expect(gscAnalyticsRunTool.inputSchema.properties.site).toBeDefined();
    expect(gscAnalyticsRunTool.inputSchema.properties.config).toBeDefined();
    expect(gscAnalyticsRunTool.inputSchema.oneOf).toBeDefined();
  });

  it('defines all optional parameters', () => {
    const props = gscAnalyticsRunTool.inputSchema.properties;
    expect(props.days).toBeDefined();
    expect(props.dimensions).toBeDefined();
    expect(props.limit).toBeDefined();
    expect(props.format).toBeDefined();
    expect(props.dry_run).toBeDefined();
  });
});
