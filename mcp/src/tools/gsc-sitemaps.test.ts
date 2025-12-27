import { describe, it, expect } from 'vitest';
import {
  gscSitemapsListInputSchema,
  gscSitemapsSubmitInputSchema,
  gscSitemapsDeleteInputSchema,
  gscSitemapsGetInputSchema,
  buildSitemapsListArgs,
  buildSitemapsSubmitArgs,
  buildSitemapsDeleteArgs,
  buildSitemapsGetArgs,
  parseSitemapsListOutput,
  parseSitemapsSubmitOutput,
  parseSitemapsDeleteOutput,
  parseSitemapsGetOutput,
  GscSitemapsListInput,
  GscSitemapsSubmitInput,
  GscSitemapsDeleteInput,
  GscSitemapsGetInput,
} from './gsc-sitemaps.js';

describe('gsc_sitemaps_list tool', () => {
  describe('input schema validation', () => {
    it('accepts valid site URL (domain property)', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscSitemapsListInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts valid site URL (URL prefix)', () => {
      const input = { site: 'https://example.com/' };
      const result = gscSitemapsListInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects empty input', () => {
      const input = {};
      const result = gscSitemapsListInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing site', () => {
      const input = { other: 'value' };
      const result = gscSitemapsListInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty site string', () => {
      const input = { site: '' };
      const result = gscSitemapsListInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildSitemapsListArgs', () => {
    it('builds args for domain property site', () => {
      const input: GscSitemapsListInput = { site: 'sc-domain:example.com' };
      const args = buildSitemapsListArgs(input);
      expect(args).toEqual(['gsc', 'sitemaps', 'list', '--site', 'sc-domain:example.com']);
    });

    it('builds args for URL prefix site', () => {
      const input: GscSitemapsListInput = { site: 'https://example.com/' };
      const args = buildSitemapsListArgs(input);
      expect(args).toEqual(['gsc', 'sitemaps', 'list', '--site', 'https://example.com/']);
    });
  });

  describe('parseSitemapsListOutput', () => {
    it('parses successful output with multiple sitemaps', () => {
      const output = `
Listing sitemaps for sc-domain:example.com
+--------------------------------------+------+--------+----------+------------------+--------+
|             SITEMAP URL              | URLS | ERRORS | WARNINGS |  LAST SUBMITTED  | STATUS |
+--------------------------------------+------+--------+----------+------------------+--------+
| https://example.com/sitemap.xml      |  150 |      0 |        0 | 2024-01-15 10:30 | OK     |
| https://example.com/sitemap-blog.xml |   45 |      0 |        2 | 2024-01-14 08:00 | Warnings: 2 |
| https://example.com/sitemap-news.xml |   30 |      1 |        0 | 2024-01-13 12:15 | Errors: 1   |
+--------------------------------------+------+--------+----------+------------------+--------+

Found 3 sitemap(s)
`;

      const result = parseSitemapsListOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('list');
      expect(result.sitemaps).toHaveLength(3);
      expect(result.sitemaps[0]).toMatchObject({
        url: 'https://example.com/sitemap.xml',
        urls_count: 150,
        errors: 0,
        warnings: 0,
        status: 'OK',
      });
      expect(result.sitemaps[1].warnings).toBe(2);
      expect(result.sitemaps[2].errors).toBe(1);
    });

    it('parses output with no sitemaps', () => {
      const output = `
Listing sitemaps for sc-domain:example.com
No sitemaps found for this site
`;

      const result = parseSitemapsListOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemaps).toHaveLength(0);
    });

    it('parses output with sitemap index', () => {
      const output = `
Listing sitemaps for sc-domain:example.com
+----------------------------------------+------+--------+----------+------------------+--------+
|              SITEMAP URL               | URLS | ERRORS | WARNINGS |  LAST SUBMITTED  | STATUS |
+----------------------------------------+------+--------+----------+------------------+--------+
| https://example.com/sitemap.xml (Index) |  500 |      0 |        0 | 2024-01-15 10:30 | OK     |
+----------------------------------------+------+--------+----------+------------------+--------+

Found 1 sitemap(s)
`;

      const result = parseSitemapsListOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemaps).toHaveLength(1);
      expect(result.sitemaps[0].is_index).toBe(true);
    });

    it('parses output with pending status', () => {
      const output = `
Listing sitemaps for sc-domain:example.com
+----------------------------------------+------+--------+----------+------------------+---------+
|              SITEMAP URL               | URLS | ERRORS | WARNINGS |  LAST SUBMITTED  | STATUS  |
+----------------------------------------+------+--------+----------+------------------+---------+
| https://example.com/sitemap.xml        |    0 |      0 |        0 | 2024-01-15 10:30 | Pending |
+----------------------------------------+------+--------+----------+------------------+---------+

Found 1 sitemap(s)
`;

      const result = parseSitemapsListOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemaps[0].is_pending).toBe(true);
    });

    it('handles error output', () => {
      const output = `
Failed to list sitemaps: site not verified
`;

      const result = parseSitemapsListOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('site not verified');
    });
  });
});

describe('gsc_sitemaps_submit tool', () => {
  describe('input schema validation', () => {
    it('accepts valid site and url', () => {
      const input = { site: 'sc-domain:example.com', url: 'https://example.com/sitemap.xml' };
      const result = gscSitemapsSubmitInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects missing site', () => {
      const input = { url: 'https://example.com/sitemap.xml' };
      const result = gscSitemapsSubmitInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing url', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscSitemapsSubmitInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects empty strings', () => {
      const input = { site: '', url: '' };
      const result = gscSitemapsSubmitInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildSitemapsSubmitArgs', () => {
    it('builds args for submit', () => {
      const input: GscSitemapsSubmitInput = {
        site: 'sc-domain:example.com',
        url: 'https://example.com/sitemap.xml',
      };
      const args = buildSitemapsSubmitArgs(input);
      expect(args).toEqual([
        'gsc', 'sitemaps', 'submit',
        '--site', 'sc-domain:example.com',
        '--url', 'https://example.com/sitemap.xml',
      ]);
    });
  });

  describe('parseSitemapsSubmitOutput', () => {
    it('parses successful submit output', () => {
      const output = `
Submitting sitemap to Google Search Console...
   Site: sc-domain:example.com
   Sitemap: https://example.com/sitemap.xml
Sitemap submitted successfully

Note: It may take a few hours for Google to process the sitemap.
Use 'ga4 gsc sitemaps get' to check the status later.
`;

      const result = parseSitemapsSubmitOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('submit');
      expect(result.sitemap_url).toBe('https://example.com/sitemap.xml');
    });

    it('handles failed submit', () => {
      const output = `
Submitting sitemap to Google Search Console...
   Site: sc-domain:example.com
   Sitemap: https://example.com/sitemap.xml
Failed to submit sitemap: sitemap URL not accessible
`;

      const result = parseSitemapsSubmitOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('sitemap URL not accessible');
    });
  });
});

describe('gsc_sitemaps_delete tool', () => {
  describe('input schema validation', () => {
    it('accepts valid site and url', () => {
      const input = { site: 'sc-domain:example.com', url: 'https://example.com/old-sitemap.xml' };
      const result = gscSitemapsDeleteInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects missing site', () => {
      const input = { url: 'https://example.com/sitemap.xml' };
      const result = gscSitemapsDeleteInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing url', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscSitemapsDeleteInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildSitemapsDeleteArgs', () => {
    it('builds args for delete', () => {
      const input: GscSitemapsDeleteInput = {
        site: 'sc-domain:example.com',
        url: 'https://example.com/old-sitemap.xml',
      };
      const args = buildSitemapsDeleteArgs(input);
      expect(args).toEqual([
        'gsc', 'sitemaps', 'delete',
        '--site', 'sc-domain:example.com',
        '--url', 'https://example.com/old-sitemap.xml',
      ]);
    });
  });

  describe('parseSitemapsDeleteOutput', () => {
    it('parses successful delete output', () => {
      const output = `
Deleting sitemap from Google Search Console...
   Site: sc-domain:example.com
   Sitemap: https://example.com/old-sitemap.xml
Sitemap deleted successfully

Note: This only removes the sitemap from Search Console.
The sitemap file itself is still hosted on your server.
`;

      const result = parseSitemapsDeleteOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('delete');
      expect(result.sitemap_url).toBe('https://example.com/old-sitemap.xml');
    });

    it('handles failed delete', () => {
      const output = `
Deleting sitemap from Google Search Console...
   Site: sc-domain:example.com
   Sitemap: https://example.com/nonexistent.xml
Failed to delete sitemap: sitemap not found
`;

      const result = parseSitemapsDeleteOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('sitemap not found');
    });
  });
});

describe('gsc_sitemaps_get tool', () => {
  describe('input schema validation', () => {
    it('accepts valid site and url', () => {
      const input = { site: 'sc-domain:example.com', url: 'https://example.com/sitemap.xml' };
      const result = gscSitemapsGetInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects missing site', () => {
      const input = { url: 'https://example.com/sitemap.xml' };
      const result = gscSitemapsGetInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing url', () => {
      const input = { site: 'sc-domain:example.com' };
      const result = gscSitemapsGetInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildSitemapsGetArgs', () => {
    it('builds args for get', () => {
      const input: GscSitemapsGetInput = {
        site: 'sc-domain:example.com',
        url: 'https://example.com/sitemap.xml',
      };
      const args = buildSitemapsGetArgs(input);
      expect(args).toEqual([
        'gsc', 'sitemaps', 'get',
        '--site', 'sc-domain:example.com',
        '--url', 'https://example.com/sitemap.xml',
      ]);
    });
  });

  describe('parseSitemapsGetOutput', () => {
    it('parses successful get output with full details', () => {
      const output = `
Retrieving sitemap details...

--- Sitemap Details ---
URL: https://example.com/sitemap.xml
Type: Regular Sitemap
Last Submitted: 2024-01-15 10:30:45
Last Downloaded: 2024-01-15 10:35:00
Status: Processed
Errors: 0
Warnings: 0

--- Content Breakdown ---
+-------+-----------+---------+
| TYPE  | SUBMITTED | INDEXED |
+-------+-----------+---------+
| web   |       150 | 145 (96.7%) |
| image |        50 |  48 (96.0%) |
+-------+-----------+---------+
`;

      const result = parseSitemapsGetOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('get');
      expect(result.sitemap).toBeDefined();
      expect(result.sitemap?.url).toBe('https://example.com/sitemap.xml');
      expect(result.sitemap?.type).toBe('Regular Sitemap');
      expect(result.sitemap?.is_pending).toBe(false);
      expect(result.sitemap?.errors).toBe(0);
      expect(result.sitemap?.warnings).toBe(0);
      expect(result.sitemap?.contents).toHaveLength(2);
      expect(result.sitemap?.contents?.[0]).toMatchObject({
        type: 'web',
        submitted: 150,
        indexed: 145,
      });
    });

    it('parses sitemap index output', () => {
      const output = `
Retrieving sitemap details...

--- Sitemap Details ---
URL: https://example.com/sitemap.xml
Type: Sitemap Index
Last Submitted: 2024-01-15 10:30:45
Status: Processed
Errors: 0
Warnings: 0
`;

      const result = parseSitemapsGetOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemap?.type).toBe('Sitemap Index');
      expect(result.sitemap?.is_index).toBe(true);
    });

    it('parses pending sitemap output', () => {
      const output = `
Retrieving sitemap details...

--- Sitemap Details ---
URL: https://example.com/sitemap.xml
Type: Regular Sitemap
Last Submitted: 2024-01-15 10:30:45
Status: Pending (Google is processing)
Errors: 0
Warnings: 0
`;

      const result = parseSitemapsGetOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemap?.is_pending).toBe(true);
    });

    it('parses sitemap with errors and warnings', () => {
      const output = `
Retrieving sitemap details...

--- Sitemap Details ---
URL: https://example.com/sitemap.xml
Type: Regular Sitemap
Last Submitted: 2024-01-15 10:30:45
Status: Processed
Errors: 5
Warnings: 10
`;

      const result = parseSitemapsGetOutput(output);

      expect(result.success).toBe(true);
      expect(result.sitemap?.errors).toBe(5);
      expect(result.sitemap?.warnings).toBe(10);
    });

    it('handles failed get', () => {
      const output = `
Retrieving sitemap details...
Failed to get sitemap: sitemap not found
`;

      const result = parseSitemapsGetOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('sitemap not found');
    });
  });
});
