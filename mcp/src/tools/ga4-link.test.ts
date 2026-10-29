import { describe, it, expect } from 'vitest';
import {
  ga4LinkListInputSchema,
  ga4LinkCreateInputSchema,
  ga4LinkRemoveInputSchema,
  buildLinkListArgs,
  buildLinkCreateArgs,
  buildLinkRemoveArgs,
  parseLinkListOutput,
  parseLinkCreateOutput,
  parseLinkRemoveOutput,
  GA4LinkCreateInput,
} from './ga4-link.js';

describe('ga4_link tools (split)', () => {
  describe('input schema validation', () => {
    it('list: accepts project_name', () => {
      expect(ga4LinkListInputSchema.safeParse({ project_name: 'basic-ecommerce' }).success).toBe(true);
    });

    it('list: rejects missing project_name', () => {
      expect(ga4LinkListInputSchema.safeParse({}).success).toBe(false);
    });

    it('create: accepts project_name with service', () => {
      const input = { project_name: 'basic-ecommerce', service: 'channels' };
      expect(ga4LinkCreateInputSchema.safeParse(input).success).toBe(true);
    });

    it('create: rejects missing service', () => {
      expect(ga4LinkCreateInputSchema.safeParse({ project_name: 'basic' }).success).toBe(false);
    });

    it('create: requires url for search-console service', () => {
      const input = { project_name: 'basic', service: 'search-console' };
      expect(ga4LinkCreateInputSchema.safeParse(input).success).toBe(false);
    });

    it('create: accepts search-console with url', () => {
      const input = { project_name: 'basic', service: 'search-console', url: 'https://example.com' };
      expect(ga4LinkCreateInputSchema.safeParse(input).success).toBe(true);
    });

    it('create: requires gcp_project and dataset for bigquery service', () => {
      expect(ga4LinkCreateInputSchema.safeParse({ project_name: 'basic', service: 'bigquery' }).success).toBe(false);
      expect(
        ga4LinkCreateInputSchema.safeParse({ project_name: 'basic', service: 'bigquery', gcp_project: 'my-project' })
          .success,
      ).toBe(false);
    });

    it('create: accepts bigquery with gcp_project and dataset', () => {
      const input = {
        project_name: 'basic',
        service: 'bigquery',
        gcp_project: 'my-project',
        dataset: 'analytics',
      };
      expect(ga4LinkCreateInputSchema.safeParse(input).success).toBe(true);
    });

    it('create: rejects invalid service value', () => {
      expect(ga4LinkCreateInputSchema.safeParse({ project_name: 'basic', service: 'invalid' }).success).toBe(false);
    });

    it('remove: accepts bigquery and channels', () => {
      expect(ga4LinkRemoveInputSchema.safeParse({ project_name: 'basic', service: 'bigquery' }).success).toBe(true);
      expect(ga4LinkRemoveInputSchema.safeParse({ project_name: 'basic', service: 'channels' }).success).toBe(true);
    });

    it('remove: rejects search-console (cannot unlink via API)', () => {
      expect(ga4LinkRemoveInputSchema.safeParse({ project_name: 'basic', service: 'search-console' }).success).toBe(
        false,
      );
    });
  });

  describe('buildArgs', () => {
    it('list', () => {
      expect(buildLinkListArgs({ project_name: 'my-project' })).toEqual(['--project', 'my-project', '--list']);
    });

    it('remove', () => {
      expect(buildLinkRemoveArgs({ project_name: 'my-project', service: 'bigquery' })).toEqual([
        '--project',
        'my-project',
        '--unlink',
        'bigquery',
      ]);
    });

    it('create: channels service', () => {
      expect(buildLinkCreateArgs({ project_name: 'my-project', service: 'channels' })).toEqual([
        '--project',
        'my-project',
        '--service',
        'channels',
      ]);
    });

    it('create: search-console with url', () => {
      const input: GA4LinkCreateInput = {
        project_name: 'my-project',
        service: 'search-console',
        url: 'https://example.com',
      };
      expect(buildLinkCreateArgs(input)).toEqual([
        '--project',
        'my-project',
        '--service',
        'search-console',
        '--url',
        'https://example.com',
      ]);
    });

    it('create: bigquery with gcp_project and dataset', () => {
      const input: GA4LinkCreateInput = {
        project_name: 'my-project',
        service: 'bigquery',
        gcp_project: 'my-gcp-project',
        dataset: 'analytics_dataset',
      };
      expect(buildLinkCreateArgs(input)).toEqual([
        '--project',
        'my-project',
        '--service',
        'bigquery',
        '--gcp-project',
        'my-gcp-project',
        '--dataset',
        'analytics_dataset',
      ]);
    });
  });

  describe('parseLinkListOutput', () => {
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

      const result = parseLinkListOutput(output);

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

      const result = parseLinkListOutput(output);

      expect(result.success).toBe(true);
      const listResults = result.results as any;
      expect(listResults.bigquery).toHaveLength(0);
      expect(listResults.channel_groups).toHaveLength(0);
    });
  });

  describe('parseLinkCreateOutput', () => {
    it('parses successful bigquery link creation', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
📊 Linking BigQuery...
✓ Successfully created BigQuery link: properties/123456789/bigQueryLinks/xyz123
`;

      const result = parseLinkCreateOutput(output, 'bigquery');

      expect(result.success).toBe(true);
      expect(result.action).toBe('link');

      const linkResult = result.results as any;
      expect(linkResult.success).toBe(true);
      expect(linkResult.service).toBe('bigquery');
      expect(linkResult.message).toContain('created successfully');
    });

    it('parses bigquery link already exists', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
📊 Linking BigQuery...
✓ A BigQuery link already exists for this property. No action taken.
`;

      const result = parseLinkCreateOutput(output, 'bigquery');

      expect(result.success).toBe(true);
      const linkResult = result.results as any;
      expect(linkResult.success).toBe(true);
      expect(linkResult.message).toContain('already exists');
    });

    it('parses search console guide output', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
🔗 Search Console Link Setup Guide
ℹ The GA4 Admin API does not support programmatic Search Console linking. Please follow the manual steps above.
`;

      const result = parseLinkCreateOutput(output, 'search-console');

      expect(result.success).toBe(true);
      const linkResult = result.results as any;
      expect(linkResult.success).toBe(true);
      expect(linkResult.action).toBe('guide');
      expect(linkResult.service).toBe('search-console');
    });

    it('parses channels setup completion', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
📡 Setting up default Channel Groups...
✓ Channel group setup process completed.
`;

      const result = parseLinkCreateOutput(output, 'channels');

      expect(result.success).toBe(true);
      const linkResult = result.results as any;
      expect(linkResult.success).toBe(true);
      expect(linkResult.service).toBe('channels');
      expect(linkResult.message).toContain('completed');
    });
  });

  describe('parseLinkRemoveOutput', () => {
    it('parses successful bigquery unlink', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
🔓 Unlinking service: bigquery
Deleting link: properties/123456789/bigQueryLinks/xyz123
✓ Successfully deleted properties/123456789/bigQueryLinks/xyz123
`;

      const result = parseLinkRemoveOutput(output, 'bigquery');

      expect(result.success).toBe(true);
      expect(result.action).toBe('unlink');

      const unlinkResult = result.results as any;
      expect(unlinkResult.success).toBe(true);
      expect(unlinkResult.service).toBe('bigquery');
      expect(unlinkResult.action).toBe('unlink');
    });

    it('parses no links to unlink', () => {
      const output = `
📦 Project: MyProject (Property: 123456789)
🔓 Unlinking service: channels
No custom channel groups found to unlink.
`;

      const result = parseLinkRemoveOutput(output, 'channels');

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
Error: failed to create GA4 client: missing credentials
`;

      const result = parseLinkCreateOutput(output, 'channels');

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing credentials');
    });
  });
});
