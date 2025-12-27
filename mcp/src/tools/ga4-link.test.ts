import { describe, it, expect } from 'vitest';
import {
  ga4LinkInputSchema,
  buildLinkArgs,
  parseLinkOutput,
  GA4LinkInput,
} from './ga4-link.js';

describe('ga4_link tool', () => {
  describe('input schema validation', () => {
    it('accepts project_name with service', () => {
      const input = { project_name: 'basic-ecommerce', service: 'channels' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts project_name with list flag', () => {
      const input = { project_name: 'basic-ecommerce', list: true };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts project_name with unlink', () => {
      const input = { project_name: 'basic-ecommerce', unlink: 'bigquery' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects missing project_name', () => {
      const input = { service: 'channels' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects project_name without action', () => {
      const input = { project_name: 'basic-ecommerce' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('requires url for search-console service', () => {
      const input = { project_name: 'basic', service: 'search-console' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('accepts search-console with url', () => {
      const input = {
        project_name: 'basic',
        service: 'search-console',
        url: 'https://example.com'
      };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('requires gcp_project and dataset for bigquery service', () => {
      const input = { project_name: 'basic', service: 'bigquery' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);

      const inputWithProject = {
        project_name: 'basic',
        service: 'bigquery',
        gcp_project: 'my-project'
      };
      const result2 = ga4LinkInputSchema.safeParse(inputWithProject);
      expect(result2.success).toBe(false);
    });

    it('accepts bigquery with gcp_project and dataset', () => {
      const input = {
        project_name: 'basic',
        service: 'bigquery',
        gcp_project: 'my-project',
        dataset: 'analytics'
      };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects invalid service value', () => {
      const input = { project_name: 'basic', service: 'invalid-service' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid unlink value', () => {
      const input = { project_name: 'basic', unlink: 'search-console' };
      const result = ga4LinkInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildLinkArgs', () => {
    it('builds args for list operation', () => {
      const input: GA4LinkInput = { project_name: 'my-project', list: true };
      const args = buildLinkArgs(input);
      expect(args).toEqual(['--project', 'my-project', '--list']);
    });

    it('builds args for unlink operation', () => {
      const input: GA4LinkInput = { project_name: 'my-project', unlink: 'bigquery' };
      const args = buildLinkArgs(input);
      expect(args).toEqual(['--project', 'my-project', '--unlink', 'bigquery']);
    });

    it('builds args for channels service', () => {
      const input: GA4LinkInput = { project_name: 'my-project', service: 'channels' };
      const args = buildLinkArgs(input);
      expect(args).toEqual(['--project', 'my-project', '--service', 'channels']);
    });

    it('builds args for search-console with url', () => {
      const input: GA4LinkInput = {
        project_name: 'my-project',
        service: 'search-console',
        url: 'https://example.com'
      };
      const args = buildLinkArgs(input);
      expect(args).toEqual([
        '--project', 'my-project',
        '--service', 'search-console',
        '--url', 'https://example.com'
      ]);
    });

    it('builds args for bigquery with gcp_project and dataset', () => {
      const input: GA4LinkInput = {
        project_name: 'my-project',
        service: 'bigquery',
        gcp_project: 'my-gcp-project',
        dataset: 'analytics_dataset'
      };
      const args = buildLinkArgs(input);
      expect(args).toEqual([
        '--project', 'my-project',
        '--service', 'bigquery',
        '--gcp-project', 'my-gcp-project',
        '--dataset', 'analytics_dataset'
      ]);
    });
  });

  describe('parseLinkOutput', () => {
    describe('list operation', () => {
      it('parses list output with BigQuery and Channel Groups', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

🔍 Existing Links and Configurations

Search Console:
  ○ Manual check required. The Admin API cannot list Search Console links.

BigQuery Export:
  ✓ Project: my-gcp-project
    Daily: true, Streaming: false

Channel Groups:
  ✓ Custom Campaign Channel
  ✓ Paid Social Ads
`;

        const input: GA4LinkInput = { project_name: 'test', list: true };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        expect(result.operation).toBe('link');
        expect(result.action).toBe('list');
        expect(result.project?.name).toBe('MyProject');
        expect(result.project?.property_id).toBe('123456789');

        const listResults = result.results as any;
        expect(listResults.search_console.status).toBe('manual_check_required');
        expect(listResults.bigquery).toHaveLength(1);
        expect(listResults.bigquery[0].project).toBe('my-gcp-project');
        expect(listResults.bigquery[0].daily_export).toBe(true);
        expect(listResults.bigquery[0].streaming_export).toBe(false);
        expect(listResults.channel_groups).toHaveLength(2);
      });

      it('parses list output with no links', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: EmptyProject (Property: 987654321)
───────────────────────────────────────────────

🔍 Existing Links and Configurations

Search Console:
  ○ Manual check required. The Admin API cannot list Search Console links.

BigQuery Export:
  ○ No BigQuery export configured.

Channel Groups:
  ○ No custom channel groups found.
`;

        const input: GA4LinkInput = { project_name: 'test', list: true };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        const listResults = result.results as any;
        expect(listResults.bigquery).toHaveLength(0);
        expect(listResults.channel_groups).toHaveLength(0);
      });
    });

    describe('link operation', () => {
      it('parses successful bigquery link creation', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

📊 Linking BigQuery...
✓ Successfully created BigQuery link: properties/123456789/bigQueryLinks/xyz123
`;

        const input: GA4LinkInput = {
          project_name: 'test',
          service: 'bigquery',
          gcp_project: 'my-project',
          dataset: 'analytics'
        };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        expect(result.action).toBe('link');

        const linkResult = result.results as any;
        expect(linkResult.success).toBe(true);
        expect(linkResult.service).toBe('bigquery');
        expect(linkResult.message).toContain('created successfully');
      });

      it('parses bigquery link already exists', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

📊 Linking BigQuery...
✓ A BigQuery link already exists for this property. No action taken.
`;

        const input: GA4LinkInput = {
          project_name: 'test',
          service: 'bigquery',
          gcp_project: 'my-project',
          dataset: 'analytics'
        };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        const linkResult = result.results as any;
        expect(linkResult.success).toBe(true);
        expect(linkResult.message).toContain('already exists');
      });

      it('parses search console guide output', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

🔗 Search Console Link Setup Guide
...guide content...
ℹ The GA4 Admin API does not support programmatic Search Console linking. Please follow the manual steps above.
`;

        const input: GA4LinkInput = {
          project_name: 'test',
          service: 'search-console',
          url: 'https://example.com'
        };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        const linkResult = result.results as any;
        expect(linkResult.success).toBe(true);
        expect(linkResult.action).toBe('guide');
        expect(linkResult.service).toBe('search-console');
      });

      it('parses channels setup completion', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

📡 Setting up default Channel Groups...
✓ Channel group setup process completed.
Please check the output above for the status of each channel group.
`;

        const input: GA4LinkInput = { project_name: 'test', service: 'channels' };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        const linkResult = result.results as any;
        expect(linkResult.success).toBe(true);
        expect(linkResult.service).toBe('channels');
        expect(linkResult.message).toContain('completed');
      });
    });

    describe('unlink operation', () => {
      it('parses successful bigquery unlink', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

🔓 Unlinking service: bigquery
Deleting link: properties/123456789/bigQueryLinks/xyz123
✓ Successfully deleted properties/123456789/bigQueryLinks/xyz123
`;

        const input: GA4LinkInput = { project_name: 'test', unlink: 'bigquery' };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        expect(result.action).toBe('unlink');

        const unlinkResult = result.results as any;
        expect(unlinkResult.success).toBe(true);
        expect(unlinkResult.service).toBe('bigquery');
        expect(unlinkResult.action).toBe('unlink');
      });

      it('parses no links to unlink', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
📦 Project: MyProject (Property: 123456789)
───────────────────────────────────────────────

🔓 Unlinking service: channels
No custom channel groups found to unlink.
`;

        const input: GA4LinkInput = { project_name: 'test', unlink: 'channels' };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(true);
        const unlinkResult = result.results as any;
        expect(unlinkResult.success).toBe(true);
        expect(unlinkResult.message).toContain('No');
      });
    });

    describe('error handling', () => {
      it('handles error output', () => {
        const output = `
🔗 GA4 Manager - Link External Services
═══════════════════════════════════════════════
Error: failed to create GA4 client: missing credentials
`;

        const input: GA4LinkInput = { project_name: 'test', service: 'channels' };
        const result = parseLinkOutput(output, input);

        expect(result.success).toBe(false);
        expect(result.error).toContain('missing credentials');
      });
    });
  });
});
