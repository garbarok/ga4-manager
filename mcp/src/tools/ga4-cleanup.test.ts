import { describe, it, expect } from 'vitest';
import { ga4CleanupInputSchema, buildCleanupArgs, parseCleanupOutput, GA4CleanupInput } from './ga4-cleanup.js';

describe('ga4_cleanup tool', () => {
  describe('input schema validation', () => {
    it('accepts config_path input', () => {
      const input = { config_path: 'configs/my-project.yaml' };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts project_name input', () => {
      const input = { project_name: 'basic-ecommerce' };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts all flag input', () => {
      const input = { all: true };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts type option', () => {
      const inputs = [
        { config_path: 'test.yaml', type: 'conversions' as const },
        { config_path: 'test.yaml', type: 'dimensions' as const },
        { config_path: 'test.yaml', type: 'metrics' as const },
        { config_path: 'test.yaml', type: 'all' as const },
      ];

      for (const input of inputs) {
        const result = ga4CleanupInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('accepts dry_run with config_path', () => {
      const input = { config_path: 'configs/test.yaml', dry_run: true };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dry_run).toBe(true);
      }
    });

    it('accepts yes flag to skip confirmation', () => {
      const input = { config_path: 'configs/test.yaml', yes: true };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.yes).toBe(true);
      }
    });

    it('rejects empty input', () => {
      const input = {};
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
      const input = { config_path: 'test.yaml', type: 'invalid' };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('allows type to be undefined (defaults to all in CLI)', () => {
      const input = { config_path: 'test.yaml' };
      const result = ga4CleanupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        // type is optional, CLI defaults to 'all' when not specified
        expect(result.data.type).toBeUndefined();
      }
    });
  });

  describe('buildCleanupArgs', () => {
    it('builds args for config_path', () => {
      const input: GA4CleanupInput = { config_path: 'configs/my-project.yaml' };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--config');
      expect(args).toContain('configs/my-project.yaml');
      expect(args).toContain('--yes');
    });

    it('builds args for project_name', () => {
      const input: GA4CleanupInput = { project_name: 'basic-ecommerce' };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--project');
      expect(args).toContain('basic-ecommerce');
      expect(args).toContain('--yes');
    });

    it('builds args for all flag', () => {
      const input: GA4CleanupInput = { all: true };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--all');
      expect(args).toContain('--yes');
    });

    it('includes type flag when not all', () => {
      const input: GA4CleanupInput = { config_path: 'test.yaml', type: 'conversions' };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--type');
      expect(args).toContain('conversions');
    });

    it('excludes type flag when all (default)', () => {
      const input: GA4CleanupInput = { config_path: 'test.yaml', type: 'all' };
      const args = buildCleanupArgs(input);
      expect(args).not.toContain('--type');
    });

    it('includes dry-run flag when true', () => {
      const input: GA4CleanupInput = { config_path: 'test.yaml', dry_run: true };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--dry-run');
    });

    it('always includes --yes to skip prompts', () => {
      const input: GA4CleanupInput = { config_path: 'test.yaml' };
      const args = buildCleanupArgs(input);
      expect(args).toContain('--yes');
    });
  });

  describe('parseCleanupOutput', () => {
    it('parses dry-run output with conversions', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Conversion Events to Remove:
|   EVENT NAME          |    STATUS       |
|-----------------------|-----------------|
| old_conversion_event  | Will be deleted |
| deprecated_tracking   | Will be deleted |

Dry-run mode enabled - no changes applied

===============================================
Dry-run complete! No changes were applied.
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.project?.name).toBe('MyWebsite');
      expect(result.project?.property_id).toBe('123456789');
      expect(result.conversions?.items.length).toBe(2);
      expect(result.conversions?.items[0].status).toBe('will_delete');
    });

    it('parses dry-run output with dimensions', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Custom Dimensions to Remove:
| PARAMETER NAME    | STATUS          |
|-------------------|-----------------|
| unused_dimension  | Will be archived|
| old_parameter     | Will be archived|

Dry-run mode enabled - no changes applied
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.dimensions?.items.length).toBe(2);
      expect(result.dimensions?.items[0].status).toBe('will_archive');
    });

    it('parses dry-run output with metrics', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Custom Metrics to Remove:
| PARAMETER NAME     | STATUS          |
|--------------------|-----------------|
| deprecated_metric  | Will be archived|

Dry-run mode enabled - no changes applied
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.metrics?.items.length).toBe(1);
      expect(result.metrics?.items[0].status).toBe('will_archive');
    });

    it('parses successful cleanup execution', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Removing conversion events...
  ✓ old_conversion_event
  ✓ deprecated_tracking

Archiving custom dimensions...
  ✓ unused_dimension
  ○ old_parameter (already archived)

Archiving custom metrics...
  ✓ deprecated_metric

===============================================
Cleanup complete!
`;

      const result = parseCleanupOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(false);
      expect(result.conversions?.removed).toBe(2);
      expect(result.dimensions?.removed).toBe(1);
      expect(result.dimensions?.already_removed).toBe(1);
      expect(result.metrics?.removed).toBe(1);
    });

    it('parses cleanup with errors', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Removing conversion events...
  ✓ old_conversion_event
  ✗ bad_event: API error occurred

Cleanup complete!
`;

      const result = parseCleanupOutput(output, false);

      expect(result.conversions?.removed).toBe(1);
      expect(result.conversions?.errors).toBe(1);
      expect(result.conversions?.items[1].status).toBe('error');
      expect(result.conversions?.items[1].error).toBe('API error occurred');
    });

    it('handles no cleanup configured', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: SnapCompress (Property: 513421535)
-----------------------------------------------
No cleanup configured for this project

===============================================
Dry-run complete! No changes were applied.
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.message).toBe('No cleanup configured for this project');
      expect(result.conversions).toBeUndefined();
      expect(result.dimensions).toBeUndefined();
      expect(result.metrics).toBeUndefined();
    });

    it('handles config file not found error', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Error: config file not found: personal (use --config to specify a YAML config file)
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain('config file not found');
    });

    it('handles cleanup cancelled', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Conversion Events to Remove:
| EVENT NAME          | STATUS          |
|---------------------|-----------------|
| old_conversion      | Will be deleted |

Cleanup cancelled.
`;

      const result = parseCleanupOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cleanup cancelled by user');
    });

    it('parses all types together in dry-run', () => {
      const output = `
GA4 Manager - Cleanup
===============================================

Project: MyWebsite (Property: 123456789)
-----------------------------------------------

Conversion Events to Remove:
| EVENT NAME   | STATUS          |
|--------------|-----------------|
| event1       | Will be deleted |

Custom Dimensions to Remove:
| PARAMETER NAME | STATUS           |
|----------------|------------------|
| dim1           | Will be archived |

Custom Metrics to Remove:
| PARAMETER NAME | STATUS           |
|----------------|------------------|
| metric1        | Will be archived |

Dry-run mode enabled - no changes applied

===============================================
Dry-run complete! No changes were applied.
`;

      const result = parseCleanupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.conversions?.items.length).toBe(1);
      expect(result.dimensions?.items.length).toBe(1);
      expect(result.metrics?.items.length).toBe(1);
    });
  });
});
