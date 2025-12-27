import { describe, it, expect } from 'vitest';
import {
  gscInspectUrlInputSchema,
  buildInspectUrlArgs,
  parseInspectUrlOutput,
  GscInspectUrlInput,
} from './gsc-inspect.js';

describe('gsc_inspect_url tool', () => {
  describe('input schema validation', () => {
    it('accepts valid domain property site and URL', () => {
      const input = {
        site: 'sc-domain:example.com',
        url: 'https://example.com/page',
      };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid URL prefix site and URL', () => {
      const input = {
        site: 'https://example.com/',
        url: 'https://example.com/blog/post',
      };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects empty input', () => {
      const input = {};
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing site', () => {
      const input = { url: 'https://example.com/page' };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing url', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty site string', () => {
      const input = { site: '', url: 'https://example.com/page' };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty url string', () => {
      const input = { site: 'sc-domain:example.com', url: '' };
      const result = gscInspectUrlInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildInspectUrlArgs', () => {
    it('builds args for domain property inspection', () => {
      const input: GscInspectUrlInput = {
        site: 'sc-domain:example.com',
        url: 'https://example.com/page',
      };
      const args = buildInspectUrlArgs(input);
      expect(args).toEqual([
        'gsc',
        'inspect',
        'url',
        '--site',
        'sc-domain:example.com',
        '--url',
        'https://example.com/page',
      ]);
    });

    it('builds args for URL prefix property inspection', () => {
      const input: GscInspectUrlInput = {
        site: 'https://example.com/',
        url: 'https://example.com/blog/post',
      };
      const args = buildInspectUrlArgs(input);
      expect(args).toEqual([
        'gsc',
        'inspect',
        'url',
        '--site',
        'https://example.com/',
        '--url',
        'https://example.com/blog/post',
      ]);
    });
  });

  describe('parseInspectUrlOutput', () => {
    it('parses successful indexed URL output', () => {
      const output = `
Inspecting URL: https://example.com/page

URL Inspection Results

URL: https://example.com/page

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

Crawl Information:
  Last Crawl: 2024-12-27 10:30:45 UTC

Indexing Status:
  Indexing Allowed

Mobile Usability:
  Mobile Usable

No issues detected

Daily Quota Status

Date: 2024-12-27
Inspections: 15 / 2000 (0.8% used, 1985 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('inspect_url');
      expect(result.url).toBe('https://example.com/page');
      expect(result.verdict).toBe('PASS');
      expect(result.coverage_state).toBe('Submitted and indexed');
      expect(result.last_crawl).toBe('2024-12-27 10:30:45 UTC');
      expect(result.indexing_allowed).toBe(true);
      expect(result.robots_blocked).toBe(false);
      expect(result.mobile_usability).toBe('PASS');
      expect(result.issues).toHaveLength(0);
      expect(result.quota).toBeDefined();
      expect(result.quota?.used).toBe(15);
      expect(result.quota?.limit).toBe(2000);
      expect(result.quota?.remaining).toBe(1985);
    });

    it('parses not indexed URL with issues', () => {
      const output = `
Inspecting URL: https://example.com/blocked

URL Inspection Results

URL: https://example.com/blocked

Index Status:
  Not Indexed (FAIL)
  Coverage: Blocked by robots.txt

Indexing Status:
  Indexing Not Allowed
  Blocked by robots.txt

Mobile Usability:
  Not Mobile Usable
  Mobile Issues:
    - TEXT_TOO_SMALL
    - VIEWPORT_NOT_SET

Issues Found:
+----------+-------------+----------------------------------+
| SEVERITY | ISSUE TYPE  | MESSAGE                          |
+----------+-------------+----------------------------------+
| ERROR    | ROBOTS_TXT  | URL is blocked by robots.txt     |
| WARNING  | MOBILE_USABILITY | Text too small to read     |
+----------+-------------+----------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 50 / 2000 (2.5% used, 1950 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('FAIL');
      expect(result.coverage_state).toBe('Blocked by robots.txt');
      expect(result.indexing_allowed).toBe(false);
      expect(result.robots_blocked).toBe(true);
      expect(result.mobile_usability).toBe('FAIL');
      expect(result.mobile_issues).toContain('TEXT_TOO_SMALL');
      expect(result.mobile_issues).toContain('VIEWPORT_NOT_SET');
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0]).toMatchObject({
        severity: 'ERROR',
        issue_type: 'ROBOTS_TXT',
      });
    });

    it('parses partially indexed URL', () => {
      const output = `
Inspecting URL: https://example.com/partial

URL Inspection Results

URL: https://example.com/partial

Index Status:
  Partially Indexed (PARTIAL)
  Coverage: Crawled - currently not indexed

No issues detected

Daily Quota Status

Date: 2024-12-27
Inspections: 100 / 2000 (5.0% used, 1900 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('PARTIAL');
      expect(result.coverage_state).toBe('Crawled - currently not indexed');
    });

    it('parses output with canonical URLs', () => {
      const output = `
Inspecting URL: https://example.com/old-page

URL Inspection Results

URL: https://example.com/old-page

Index Status:
  Not Indexed (FAIL)
  Coverage: Duplicate, Google chose different canonical than user

Canonical URLs:
  Google Canonical: https://example.com/new-page
  User Canonical: https://example.com/old-page

Issues Found:
+----------+------------------+--------------------------------------------+
| SEVERITY | ISSUE TYPE       | MESSAGE                                    |
+----------+------------------+--------------------------------------------+
| WARNING  | CANONICAL_MISMATCH | Google chose a different canonical URL   |
+----------+------------------+--------------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 200 / 2000 (10.0% used, 1800 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.google_canonical).toBe('https://example.com/new-page');
      expect(result.user_canonical).toBe('https://example.com/old-page');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].issue_type).toBe('CANONICAL_MISMATCH');
    });

    it('parses output with rich results', () => {
      const output = `
Inspecting URL: https://example.com/recipe

URL Inspection Results

URL: https://example.com/recipe

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

Rich Results:
  Valid (PASS)

No issues detected

Daily Quota Status

Date: 2024-12-27
Inspections: 25 / 2000 (1.3% used, 1975 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.rich_results_status).toBe('PASS');
    });

    it('parses output with rich results issues', () => {
      const output = `
Inspecting URL: https://example.com/article

URL Inspection Results

URL: https://example.com/article

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

Rich Results:
  Invalid (FAIL)
  Rich Results Issues:
    - Missing required property "author"
    - Invalid date format in "datePublished"

Issues Found:
+----------+---------------+----------------------------------------+
| SEVERITY | ISSUE TYPE    | MESSAGE                                |
+----------+---------------+----------------------------------------+
| ERROR    | RICH_RESULTS  | Missing required property "author"     |
| WARNING  | RICH_RESULTS  | Invalid date format in "datePublished" |
+----------+---------------+----------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 30 / 2000 (1.5% used, 1970 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.rich_results_status).toBe('FAIL');
      expect(result.rich_results_issues).toContain('Missing required property "author"');
      expect(result.rich_results_issues).toContain('Invalid date format in "datePublished"');
    });

    it('handles failed inspection error', () => {
      const output = `
Inspecting URL: https://example.com/page

Failed to inspect URL: site not verified
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('site not verified');
    });

    it('handles GSC client creation error', () => {
      const output = `
Failed to create GSC client: GOOGLE_APPLICATION_CREDENTIALS not set
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('GOOGLE_APPLICATION_CREDENTIALS not set');
    });

    it('handles quota exceeded error', () => {
      const output = `
Inspecting URL: https://example.com/page

daily quota critical threshold reached: 1950/2000 inspections used (97.5%). Please wait until tomorrow to continue
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Daily quota critical threshold reached');
    });

    it('parses quota warning status', () => {
      const output = `
Inspecting URL: https://example.com/page

URL Inspection Results

URL: https://example.com/page

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

No issues detected

Daily Quota Status

Date: 2024-12-27
Inspections: 1600 / 2000 (80.0% used, 400 remaining)
WARNING: 80% of daily quota used
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.quota).toBeDefined();
      expect(result.quota?.used).toBe(1600);
      expect(result.quota?.remaining).toBe(400);
      expect(result.quota?.warning).toContain('80% of daily quota used');
    });

    it('parses critical quota warning', () => {
      const output = `
Inspecting URL: https://example.com/page

URL Inspection Results

URL: https://example.com/page

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

Daily Quota Status

Date: 2024-12-27
Inspections: 1920 / 2000 (96.0% used, 80 remaining)
CRITICAL: Approaching daily limit!
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.quota?.used).toBe(1920);
      expect(result.quota?.remaining).toBe(80);
      expect(result.quota?.warning).toBe('CRITICAL: Approaching daily limit');
    });

    it('handles 404 not found coverage state', () => {
      const output = `
Inspecting URL: https://example.com/missing

URL Inspection Results

URL: https://example.com/missing

Index Status:
  Not Indexed (FAIL)
  Coverage: Not found (404)

Issues Found:
+----------+------------+---------------------------+
| SEVERITY | ISSUE TYPE | MESSAGE                   |
+----------+------------+---------------------------+
| ERROR    | NOT_FOUND  | Page not found (404 error)|
+----------+------------+---------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 45 / 2000 (2.3% used, 1955 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('FAIL');
      expect(result.coverage_state).toBe('Not found (404)');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].issue_type).toBe('NOT_FOUND');
    });

    it('handles soft 404 detection', () => {
      const output = `
Inspecting URL: https://example.com/empty-page

URL Inspection Results

URL: https://example.com/empty-page

Index Status:
  Not Indexed (FAIL)
  Coverage: Soft 404 detected

Issues Found:
+----------+------------+------------------------------------------------------+
| SEVERITY | ISSUE TYPE | MESSAGE                                              |
+----------+------------+------------------------------------------------------+
| WARNING  | SOFT_404   | Soft 404 detected - page returns 200 but looks like a 404 |
+----------+------------+------------------------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 60 / 2000 (3.0% used, 1940 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.coverage_state).toBe('Soft 404 detected');
      expect(result.issues[0].issue_type).toBe('SOFT_404');
      expect(result.issues[0].severity).toBe('WARNING');
    });

    it('handles redirect issues', () => {
      const output = `
Inspecting URL: https://example.com/old-url

URL Inspection Results

URL: https://example.com/old-url

Index Status:
  Indexed (PASS)
  Coverage: Page with redirect

Issues Found:
+----------+------------+--------------------------------------------------------------+
| SEVERITY | ISSUE TYPE | MESSAGE                                                      |
+----------+------------+--------------------------------------------------------------+
| WARNING  | REDIRECT   | Page has a redirect - Google follows redirects but canonical should be the final URL |
+----------+------------+--------------------------------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 70 / 2000 (3.5% used, 1930 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.issues[0].issue_type).toBe('REDIRECT');
      expect(result.issues[0].severity).toBe('WARNING');
    });

    it('handles multiple issue types', () => {
      const output = `
Inspecting URL: https://example.com/problematic

URL Inspection Results

URL: https://example.com/problematic

Index Status:
  Not Indexed (FAIL)
  Coverage: Crawled - currently not indexed

Issues Found:
+----------+----------------------+-------------------------------------------+
| SEVERITY | ISSUE TYPE           | MESSAGE                                   |
+----------+----------------------+-------------------------------------------+
| ERROR    | SERVER_ERROR_5XX     | Server error (5xx) during page fetch     |
| WARNING  | CRAWLED_NOT_INDEXED  | Page was crawled but not indexed         |
| WARNING  | MOBILE_TEXT_TOO_SMALL| Mobile usability issue: TEXT_TOO_SMALL   |
+----------+----------------------+-------------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 80 / 2000 (4.0% used, 1920 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0].severity).toBe('ERROR');
      expect(result.issues[1].severity).toBe('WARNING');
      expect(result.issues[2].severity).toBe('WARNING');
    });

    it('parses output without quota information', () => {
      const output = `
Inspecting URL: https://example.com/page

URL Inspection Results

URL: https://example.com/page

Index Status:
  Indexed (PASS)
  Coverage: Submitted and indexed

No issues detected
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('PASS');
      expect(result.quota).toBeUndefined();
    });

    it('handles noindex tag exclusion', () => {
      const output = `
Inspecting URL: https://example.com/noindex-page

URL Inspection Results

URL: https://example.com/noindex-page

Index Status:
  Not Indexed (FAIL)
  Coverage: Excluded by noindex tag

Issues Found:
+----------+-------------+----------------------------------+
| SEVERITY | ISSUE TYPE  | MESSAGE                          |
+----------+-------------+----------------------------------+
| ERROR    | NOINDEX_TAG | Page is excluded by noindex tag  |
+----------+-------------+----------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 90 / 2000 (4.5% used, 1910 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.verdict).toBe('FAIL');
      expect(result.coverage_state).toBe('Excluded by noindex tag');
      expect(result.issues[0].issue_type).toBe('NOINDEX_TAG');
    });

    it('handles discovered but not indexed state', () => {
      const output = `
Inspecting URL: https://example.com/new-page

URL Inspection Results

URL: https://example.com/new-page

Index Status:
  Not Indexed (FAIL)
  Coverage: Discovered - currently not indexed

Issues Found:
+----------+-----------------------+--------------------------------------------------------------+
| SEVERITY | ISSUE TYPE            | MESSAGE                                                      |
+----------+-----------------------+--------------------------------------------------------------+
| WARNING  | DISCOVERED_NOT_INDEXED| Page was discovered but not indexed - may need more time     |
+----------+-----------------------+--------------------------------------------------------------+

Daily Quota Status

Date: 2024-12-27
Inspections: 95 / 2000 (4.8% used, 1905 remaining)
`;

      const result = parseInspectUrlOutput(output);

      expect(result.success).toBe(true);
      expect(result.coverage_state).toBe('Discovered - currently not indexed');
      expect(result.issues[0].issue_type).toBe('DISCOVERED_NOT_INDEXED');
    });
  });
});
