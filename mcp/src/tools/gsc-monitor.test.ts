import { describe, it, expect } from 'vitest';
import {
  gscMonitorUrlsInputSchema,
  buildMonitorUrlsArgs,
  parseMonitorUrlsOutput,
  GscMonitorUrlsInput,
} from './gsc-monitor.js';

describe('gsc_monitor_urls tool', () => {
  describe('input schema validation', () => {
    it('accepts valid config path', () => {
      const input = { config: 'configs/mysite.yaml' };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts config with dry_run flag', () => {
      const input = { config: 'configs/mysite.yaml', dry_run: true };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dry_run).toBe(true);
      }
    });

    it('accepts config with format option', () => {
      const input = { config: 'configs/mysite.yaml', format: 'json' };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe('json');
      }
    });

    it('accepts config with all options', () => {
      const input = { config: 'configs/mysite.yaml', dry_run: true, format: 'markdown' };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config).toBe('configs/mysite.yaml');
        expect(result.data.dry_run).toBe(true);
        expect(result.data.format).toBe('markdown');
      }
    });

    it('rejects empty input', () => {
      const input = {};
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing config', () => {
      const input = { dry_run: true };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty config string', () => {
      const input = { config: '' };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('provides default values for optional fields', () => {
      const input = { config: 'configs/mysite.yaml' };
      const result = gscMonitorUrlsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dry_run).toBe(false);
        expect(result.data.format).toBe('json');
      }
    });
  });

  describe('buildMonitorUrlsArgs', () => {
    it('builds basic args with config only', () => {
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toEqual(['gsc', 'monitor', 'run', '--config', 'configs/mysite.yaml']);
    });

    it('builds args with dry_run flag', () => {
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', dry_run: true };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toEqual(['gsc', 'monitor', 'run', '--config', 'configs/mysite.yaml', '--dry-run']);
    });

    it('builds args with json format (default, not added)', () => {
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toEqual(['gsc', 'monitor', 'run', '--config', 'configs/mysite.yaml', '--format', 'json']);
    });

    it('builds args with markdown format', () => {
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'markdown' };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toEqual(['gsc', 'monitor', 'run', '--config', 'configs/mysite.yaml', '--format', 'markdown']);
    });

    it('builds args with all options', () => {
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', dry_run: true, format: 'markdown' };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toEqual([
        'gsc', 'monitor', 'run',
        '--config', 'configs/mysite.yaml',
        '--dry-run',
        '--format', 'markdown',
      ]);
    });

    it('handles absolute paths', () => {
      const input: GscMonitorUrlsInput = { config: '/home/user/configs/mysite.yaml' };
      const args = buildMonitorUrlsArgs(input);
      expect(args).toContain('/home/user/configs/mysite.yaml');
    });
  });

  describe('parseMonitorUrlsOutput - error handling', () => {
    it('handles config load failure', () => {
      const output = `
Failed to load config: open configs/nonexistent.yaml: no such file or directory
`;
      const input: GscMonitorUrlsInput = { config: 'configs/nonexistent.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('no such file or directory');
    });

    it('handles missing search_console config', () => {
      const output = `
✗ No search_console configuration found in configs/mysite.yaml
Error: missing search_console config
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('search_console');
    });

    it('handles missing url_inspection config', () => {
      const output = `
⚠ No url_inspection configuration found in configs/mysite.yaml
Add url_inspection.priority_urls to your config file
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('url_inspection');
    });

    it('handles no priority URLs configured', () => {
      const output = `
⚠ No priority URLs configured in url_inspection.priority_urls
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('priority URLs');
    });

    it('handles GSC client creation failure', () => {
      const output = `
✗ Failed to create GSC client: google: could not find default credentials
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('could not find default credentials');
    });

    it('handles URL inspection failure', () => {
      const output = `
🔍 Inspecting 5 priority URLs for sc-domain:example.com...

✗ Failed to inspect URLs: API error: permission denied
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
    });

    it('handles quota exceeded error', () => {
      const output = `
🔍 Inspecting 5 priority URLs for sc-domain:example.com...

✗ daily quota critical threshold reached: 1900/2000 inspections used (95%). Please wait until tomorrow to continue
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Quota exceeded');
    });
  });

  describe('parseMonitorUrlsOutput - dry run mode', () => {
    it('parses dry-run preview with URL list', () => {
      const output = `
═══ Dry-Run Mode ═══

Site: sc-domain:example.com
URLs to inspect: 3

+---+----------------------------------+
| # | URL                              |
+---+----------------------------------+
| 1 | https://example.com/             |
| 2 | https://example.com/about        |
| 3 | https://example.com/contact      |
+---+----------------------------------+

ℹ️  Dry-run mode enabled - no API calls will be made
ℹ️  Remove --dry-run flag to perform actual inspection
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', dry_run: true };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.preview).toBeDefined();
      expect(result.preview?.site).toBe('sc-domain:example.com');
      expect(result.preview?.urls_to_inspect).toHaveLength(3);
      expect(result.preview?.urls_to_inspect).toContain('https://example.com/');
      expect(result.preview?.url_count).toBe(3);
    });

    it('parses dry-run with empty URL list', () => {
      const output = `
═══ Dry-Run Mode ═══

Site: sc-domain:example.com
URLs to inspect: 0

ℹ️  Dry-run mode enabled - no API calls will be made
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', dry_run: true };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.preview?.urls_to_inspect).toHaveLength(0);
    });

    it('sets dry_run flag when output contains dry-run indicator', () => {
      const output = `
═══ Dry-Run Mode ═══

Site: sc-domain:example.com
URLs to inspect: 1
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml' }; // dry_run not set in input
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.dry_run).toBe(true);
    });
  });

  describe('parseMonitorUrlsOutput - JSON format', () => {
    it('parses JSON output with multiple results', () => {
      const output = `
🔍 Inspecting 3 priority URLs for sc-domain:example.com...

[
  {
    "URL": "https://example.com/",
    "IndexStatus": "PASS",
    "CoverageState": "SUBMITTED_AND_INDEXED",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "IndexingIssues": []
  },
  {
    "URL": "https://example.com/about",
    "IndexStatus": "PASS",
    "CoverageState": "SUBMITTED_AND_INDEXED",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "IndexingIssues": []
  },
  {
    "URL": "https://example.com/blog",
    "IndexStatus": "FAIL",
    "CoverageState": "CRAWLED_NOT_INDEXED",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "IndexingIssues": [
      {
        "Severity": "WARNING",
        "Message": "Page was crawled but not indexed",
        "IssueType": "CRAWLED_NOT_INDEXED"
      }
    ]
  }
]

═══ Summary ═══

✓ Indexed: 2
✗ Not Indexed: 1
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results?.[0].url).toBe('https://example.com/');
      expect(result.results?.[0].index_status).toBe('PASS');
      expect(result.results?.[2].index_status).toBe('FAIL');
      expect(result.results?.[2].indexing_issues).toHaveLength(1);
    });

    it('parses JSON with snake_case field names', () => {
      const output = `
[
  {
    "url": "https://example.com/",
    "index_status": "PASS",
    "coverage_state": "SUBMITTED_AND_INDEXED",
    "mobile_usable": true,
    "mobile_issues": [],
    "robots_blocked": false,
    "indexing_allowed": true,
    "indexing_issues": []
  }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results?.[0].url).toBe('https://example.com/');
      expect(result.results?.[0].index_status).toBe('PASS');
    });

    it('calculates summary statistics correctly', () => {
      const output = `
[
  { "URL": "https://example.com/1", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": [] },
  { "URL": "https://example.com/2", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": [] },
  { "URL": "https://example.com/3", "IndexStatus": "FAIL", "IndexingIssues": [{"Severity": "ERROR", "Message": "Error", "IssueType": "ERROR"}], "MobileIssues": [] },
  { "URL": "https://example.com/4", "IndexStatus": "PARTIAL", "IndexingIssues": [{"Severity": "WARNING", "Message": "Warning", "IssueType": "WARN"}], "MobileIssues": ["TEXT_TOO_SMALL"] }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary?.total_urls).toBe(4);
      expect(result.summary?.indexed).toBe(2);
      expect(result.summary?.not_indexed).toBe(1);
      expect(result.summary?.partial).toBe(1);
      expect(result.summary?.total_issues).toBe(2);
      expect(result.summary?.urls_with_issues).toBe(2);
      expect(result.summary?.mobile_issues_count).toBe(1);
    });
  });

  describe('parseMonitorUrlsOutput - quota status', () => {
    it('parses quota status from output', () => {
      const output = `
[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]

═══ Daily Quota Status ═══

Date: 2024-01-15
Inspections Used: 150 / 2000 (7.5%)
Remaining: 1850

✓ Quota usage healthy
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.quota).toBeDefined();
      expect(result.quota?.used).toBe(150);
      expect(result.quota?.limit).toBe(2000);
      expect(result.quota?.percentage).toBe(7.5);
      expect(result.quota?.remaining).toBe(1850);
      expect(result.quota?.status).toBe('healthy');
    });

    it('detects warning quota status', () => {
      const output = `
[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]

═══ Daily Quota Status ═══

Date: 2024-01-15
Inspections Used: 1600 / 2000 (80.0%)
Remaining: 400

⚠ WARNING: 80% of daily quota used
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.quota?.status).toBe('warning');
    });

    it('detects critical quota status', () => {
      const output = `
[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]

═══ Daily Quota Status ═══

Date: 2024-01-15
Inspections Used: 1950 / 2000 (97.5%)
Remaining: 50

⚠ CRITICAL: Approaching daily limit!
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.quota?.status).toBe('critical');
    });
  });

  describe('parseMonitorUrlsOutput - site extraction', () => {
    it('extracts domain property site URL', () => {
      const output = `
🔍 Inspecting 3 priority URLs for sc-domain:example.com...

[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.site).toBe('sc-domain:example.com');
    });

    it('extracts URL prefix site URL', () => {
      const output = `
🔍 Inspecting 3 priority URLs for https://example.com/...

[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.site).toBe('https://example.com/');
    });
  });

  describe('parseMonitorUrlsOutput - result details', () => {
    it('parses mobile usability issues', () => {
      const output = `
[
  {
    "URL": "https://example.com/mobile-issues",
    "IndexStatus": "PASS",
    "CoverageState": "SUBMITTED_AND_INDEXED",
    "MobileUsable": false,
    "MobileIssues": ["TEXT_TOO_SMALL", "CLICKABLE_ELEMENTS_TOO_CLOSE"],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "IndexingIssues": [
      {"Severity": "WARNING", "Message": "Mobile usability issue: TEXT_TOO_SMALL", "IssueType": "MOBILE_TEXT_TOO_SMALL"},
      {"Severity": "WARNING", "Message": "Mobile usability issue: CLICKABLE_ELEMENTS_TOO_CLOSE", "IssueType": "MOBILE_CLICKABLE_ELEMENTS_TOO_CLOSE"}
    ]
  }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.results?.[0].mobile_usable).toBe(false);
      expect(result.results?.[0].mobile_issues).toHaveLength(2);
      expect(result.results?.[0].mobile_issues).toContain('TEXT_TOO_SMALL');
    });

    it('parses robots.txt blocking', () => {
      const output = `
[
  {
    "URL": "https://example.com/blocked",
    "IndexStatus": "FAIL",
    "CoverageState": "BLOCKED_BY_ROBOTS_TXT",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": true,
    "IndexingAllowed": false,
    "IndexingIssues": [
      {"Severity": "ERROR", "Message": "URL is blocked by robots.txt", "IssueType": "ROBOTS_TXT"}
    ]
  }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.results?.[0].robots_blocked).toBe(true);
      expect(result.results?.[0].indexing_allowed).toBe(false);
      expect(result.results?.[0].indexing_issues[0].issue_type).toBe('ROBOTS_TXT');
    });

    it('parses canonical URL information', () => {
      const output = `
[
  {
    "URL": "https://example.com/page",
    "IndexStatus": "PASS",
    "CoverageState": "SUBMITTED_AND_INDEXED",
    "GoogleCanonical": "https://example.com/canonical-page",
    "UserCanonical": "https://example.com/page",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "IndexingIssues": []
  }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.results?.[0].google_canonical).toBe('https://example.com/canonical-page');
      expect(result.results?.[0].user_canonical).toBe('https://example.com/page');
    });

    it('parses rich results information', () => {
      const output = `
[
  {
    "URL": "https://example.com/article",
    "IndexStatus": "PASS",
    "CoverageState": "SUBMITTED_AND_INDEXED",
    "MobileUsable": true,
    "MobileIssues": [],
    "RobotsBlocked": false,
    "IndexingAllowed": true,
    "RichResultsStatus": "PASS",
    "RichResultsIssues": [],
    "IndexingIssues": []
  }
]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.results?.[0].rich_results_status).toBe('PASS');
      expect(result.results?.[0].rich_results_issues).toHaveLength(0);
    });
  });

  describe('parseMonitorUrlsOutput - edge cases', () => {
    it('handles empty JSON array', () => {
      const output = `
🔍 Inspecting 0 priority URLs for sc-domain:example.com...

[]
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it('handles malformed JSON gracefully', () => {
      const output = `
🔍 Inspecting 1 priority URLs for sc-domain:example.com...

[{"URL": "https://example.com/", "IndexStatus": "PASS"
`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      // Should not crash, results may be empty
      expect(result.success).toBe(true);
    });

    it('preserves operation type', () => {
      const output = `[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'json' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.operation).toBe('monitor');
    });

    it('preserves format in result', () => {
      const output = `[{"URL": "https://example.com/", "IndexStatus": "PASS", "IndexingIssues": [], "MobileIssues": []}]`;
      const input: GscMonitorUrlsInput = { config: 'configs/mysite.yaml', format: 'markdown' };
      const result = parseMonitorUrlsOutput(output, input);

      expect(result.format).toBe('markdown');
    });
  });
});
