import { describe, it, expect } from 'vitest';
import { ga4SetupInputSchema, buildSetupArgs, parseSetupOutput, GA4SetupInput } from './ga4-setup';

describe('ga4_setup tool', () => {
  describe('input schema validation', () => {
    it('accepts config_path input', () => {
      const input = { config_path: 'configs/my-project.yaml' };
      const result = ga4SetupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts project_name input', () => {
      const input = { project_name: 'basic-ecommerce' };
      const result = ga4SetupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts all flag input', () => {
      const input = { all: true };
      const result = ga4SetupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts dry_run with config_path', () => {
      const input = { config_path: 'configs/test.yaml', dry_run: true };
      const result = ga4SetupInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dry_run).toBe(true);
      }
    });

    it('rejects empty input', () => {
      const input = {};
      const result = ga4SetupInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('allows combining dry_run with any config option', () => {
      const inputs = [
        { config_path: 'test.yaml', dry_run: true },
        { project_name: 'test', dry_run: true },
        { all: true, dry_run: true },
      ];

      for (const input of inputs) {
        const result = ga4SetupInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('buildSetupArgs', () => {
    it('builds args for config_path', () => {
      const input: GA4SetupInput = { config_path: 'configs/my-project.yaml' };
      const args = buildSetupArgs(input);
      expect(args).toEqual(['--config', 'configs/my-project.yaml']);
    });

    it('builds args for project_name', () => {
      const input: GA4SetupInput = { project_name: 'basic-ecommerce' };
      const args = buildSetupArgs(input);
      expect(args).toEqual(['--project', 'basic-ecommerce']);
    });

    it('builds args for all flag', () => {
      const input: GA4SetupInput = { all: true };
      const args = buildSetupArgs(input);
      expect(args).toEqual(['--all']);
    });

    it('includes dry-run flag when true', () => {
      const input: GA4SetupInput = { config_path: 'test.yaml', dry_run: true };
      const args = buildSetupArgs(input);
      expect(args).toContain('--dry-run');
      expect(args).toContain('--config');
    });

    it('excludes dry-run flag when false or undefined', () => {
      const input: GA4SetupInput = { config_path: 'test.yaml', dry_run: false };
      const args = buildSetupArgs(input);
      expect(args).not.toContain('--dry-run');
    });
  });

  describe('parseSetupOutput', () => {
    it('parses successful GA4-only setup output', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded (configs/test.yaml)
  ✓ GA4 credentials valid
  ✓ Property access verified (513421535)

[1/2] 📊 Google Analytics 4 Setup
───────────────────────────────────────────────

🎯 Creating conversions...
  ✓ download_image
  ✓ compression_complete
  Created: 2, Skipped: 0

📊 Creating custom dimensions...
  ✓ User Type
  ✓ File Format
  ○ Compression Quality (already exists, skipping)
  Created: 2, Skipped: 1

📈 Creating custom metrics...
  ✓ Processing Time
  Created: 1, Skipped: 0

────────────────────────────────────────────────
Setup completed successfully!
Duration: 2.3s
────────────────────────────────────────────────
`;

      const result = parseSetupOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(false);
      expect(result.results.ga4).toBeDefined();
      expect(result.results.ga4?.conversions_created).toBe(2);
      expect(result.results.ga4?.conversions_skipped).toBe(0);
      expect(result.results.ga4?.dimensions_created).toBe(2);
      expect(result.results.ga4?.dimensions_skipped).toBe(1);
      expect(result.results.ga4?.metrics_created).toBe(1);
      expect(result.results.ga4?.metrics_skipped).toBe(0);
    });

    it('parses successful GSC-only setup output', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded (configs/test.yaml)
  ✓ GSC credentials valid
  ✓ Site verified (https://example.com)

[2/2] 🔍 Google Search Console Setup
───────────────────────────────────────────────

🗺️ Submitting sitemaps...
  ✓ https://example.com/sitemap.xml
  ✓ https://example.com/sitemap-pages.xml
  Submitted: 2, Skipped: 0

────────────────────────────────────────────────
Setup completed successfully!
Duration: 1.5s
────────────────────────────────────────────────
`;

      const result = parseSetupOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.results.gsc).toBeDefined();
      expect(result.results.gsc?.sitemaps_submitted).toBe(2);
      expect(result.results.gsc?.sitemaps_skipped).toBe(0);
    });

    it('parses dry-run output correctly', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

ℹ️ Dry-run mode enabled - no changes will be applied

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded (configs/test.yaml)

[1/2] 📊 Google Analytics 4 Setup
───────────────────────────────────────────────

🎯 Creating conversions...
  ○ download_image (counting: ONCE_PER_EVENT)
  ○ compression_complete (counting: ONCE_PER_SESSION)
  Created: 2, Skipped: 0

ℹ️ Dry-run complete! No changes were applied.
`;

      const result = parseSetupOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.dry_run).toBe(true);
      expect(result.results.ga4?.conversions_created).toBe(2);
    });

    it('detects validation failures', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded
  ✗ GA4 credentials invalid
    Error: Missing GOOGLE_APPLICATION_CREDENTIALS

pre-flight validation failed: missing credentials
`;

      const result = parseSetupOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.results.ga4?.errors).toBeDefined();
      expect(result.results.ga4?.errors?.length).toBeGreaterThan(0);
    });

    it('extracts property ID from output', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded (configs/test.yaml)
  ✓ Property access verified (513421535)

[1/2] 📊 Google Analytics 4 Setup
───────────────────────────────────────────────

🎯 Creating conversions...
  ✓ test_event
  Created: 1, Skipped: 0

Setup completed successfully!
`;

      const result = parseSetupOutput(output, false);

      expect(result.project?.property_id).toBe('513421535');
    });

    it('handles combined GA4 + GSC setup', () => {
      const output = `
🚀 GA4 Manager - Unified Setup
═══════════════════════════════════════════════

📋 Pre-flight Validation
───────────────────────────────────────────────
  ✓ Configuration loaded

[1/2] 📊 Google Analytics 4 Setup
───────────────────────────────────────────────

🎯 Creating conversions...
  ✓ test_event
  Created: 1, Skipped: 0

📊 Creating custom dimensions...
  ✓ User Type
  Created: 1, Skipped: 0

📈 Creating custom metrics...
  Created: 0, Skipped: 0

[2/2] 🔍 Google Search Console Setup
───────────────────────────────────────────────

🗺️ Submitting sitemaps...
  ✓ https://example.com/sitemap.xml
  Submitted: 1, Skipped: 0

Setup completed successfully!
`;

      const result = parseSetupOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.results.ga4).toBeDefined();
      expect(result.results.gsc).toBeDefined();
      expect(result.results.ga4?.conversions_created).toBe(1);
      expect(result.results.gsc?.sitemaps_submitted).toBe(1);
    });
  });
});
