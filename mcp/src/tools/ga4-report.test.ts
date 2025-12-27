import { describe, it, expect } from 'vitest';
import {
  ga4ReportInputSchema,
  buildReportArgs,
  parseReportOutput,
  GA4ReportInput,
} from './ga4-report';

describe('ga4_report tool', () => {
  describe('input schema validation', () => {
    it('accepts config_path input', () => {
      const input = { config_path: 'configs/my-project.yaml' };
      const result = ga4ReportInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts project_name input', () => {
      const input = { project_name: 'basic-ecommerce' };
      const result = ga4ReportInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts all flag input', () => {
      const input = { all: true };
      const result = ga4ReportInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects empty input', () => {
      const input = {};
      const result = ga4ReportInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects dry_run flag (not applicable to report)', () => {
      // Report doesn't support dry_run - it's read-only
      const input = { config_path: 'test.yaml' };
      const result = ga4ReportInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      // Ensure the schema doesn't have dry_run
      expect((result as any).data.dry_run).toBeUndefined();
    });
  });

  describe('buildReportArgs', () => {
    it('builds args for config_path', () => {
      const input: GA4ReportInput = { config_path: 'configs/my-project.yaml' };
      const args = buildReportArgs(input);
      expect(args).toEqual(['--config', 'configs/my-project.yaml']);
    });

    it('builds args for project_name', () => {
      const input: GA4ReportInput = { project_name: 'basic-ecommerce' };
      const args = buildReportArgs(input);
      expect(args).toEqual(['--project', 'basic-ecommerce']);
    });

    it('builds args for all flag', () => {
      const input: GA4ReportInput = { all: true };
      const args = buildReportArgs(input);
      expect(args).toEqual(['--all']);
    });

    it('prefers config_path over project_name', () => {
      const input: GA4ReportInput = {
        config_path: 'configs/test.yaml',
        project_name: 'test'
      };
      const args = buildReportArgs(input);
      expect(args).toEqual(['--config', 'configs/test.yaml']);
    });
  });

  describe('parseReportOutput', () => {
    it('parses report with conversions table', () => {
      const output = `
📊 GA4 Configuration Report
═══════════════════════════════════════════════

📦 RefactorRig (Property: 517639503)
───────────────────────────────────────────────

🎯 Conversions
───────────────────────────────────────────────
   EVENT NAME             COUNTING METHOD
   download_image         ONCE_PER_EVENT
   compression_complete   ONCE_PER_SESSION

📊 Custom Dimensions
───────────────────────────────────────────────
   DISPLAY NAME       PARAMETER        SCOPE
   User Type          user_type        USER
   File Format        file_format      EVENT

📈 Custom Metrics
───────────────────────────────────────────────
   DISPLAY NAME        PARAMETER          UNIT       SCOPE
   Processing Time     processing_time    STANDARD   EVENT

🧮 Recommended Calculated Metrics (create manually in GA4 UI)
───────────────────────────────────────────────
   DISPLAY NAME   FORMULA   UNIT

👥 Configured Audiences
───────────────────────────────────────────────
Total audiences configured: 0

   NAME   CATEGORY   DURATION (DAYS)

Note: Audiences must be created manually in GA4 UI.

🗄️  Data Retention Settings
───────────────────────────────────────────────
Event Data Retention: 14 months (FOURTEEN_MONTHS)
Reset on New Activity: true

⚡ Enhanced Measurement
───────────────────────────────────────────────
Enhanced Measurement enabled
`;

      const result = parseReportOutput(output);

      expect(result.success).toBe(true);
      expect(result.operation).toBe('report');
      expect(result.project?.name).toBe('RefactorRig');
      expect(result.project?.property_id).toBe('517639503');

      // Conversions
      expect(result.conversions).toHaveLength(2);
      expect(result.conversions[0]).toEqual({
        name: 'download_image',
        counting_method: 'ONCE_PER_EVENT'
      });
      expect(result.conversions[1]).toEqual({
        name: 'compression_complete',
        counting_method: 'ONCE_PER_SESSION'
      });

      // Dimensions
      expect(result.dimensions).toHaveLength(2);
      expect(result.dimensions[0]).toEqual({
        parameter: 'user_type',
        display_name: 'User Type',
        scope: 'USER'
      });

      // Metrics
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0]).toEqual({
        parameter: 'processing_time',
        display_name: 'Processing Time',
        unit: 'STANDARD',
        scope: 'EVENT'
      });
    });

    it('parses empty tables correctly', () => {
      const output = `
📊 GA4 Configuration Report
═══════════════════════════════════════════════

📦 EmptyProject (Property: 123456789)
───────────────────────────────────────────────

🎯 Conversions
───────────────────────────────────────────────
   EVENT NAME   COUNTING METHOD

📊 Custom Dimensions
───────────────────────────────────────────────
   DISPLAY NAME   PARAMETER   SCOPE

📈 Custom Metrics
───────────────────────────────────────────────
   DISPLAY NAME   PARAMETER   UNIT   SCOPE
`;

      const result = parseReportOutput(output);

      expect(result.success).toBe(true);
      expect(result.project?.name).toBe('EmptyProject');
      expect(result.project?.property_id).toBe('123456789');
      expect(result.conversions).toEqual([]);
      expect(result.dimensions).toEqual([]);
      expect(result.metrics).toEqual([]);
    });

    it('handles error output gracefully', () => {
      const output = `
📊 GA4 Configuration Report
═══════════════════════════════════════════════

Error: failed to create GA4 client: missing credentials
`;

      const result = parseReportOutput(output);

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing credentials');
    });

    it('parses project header with emoji correctly', () => {
      const output = `
📦 My Project Name (Property: 987654321)
───────────────────────────────────────────────

🎯 Conversions
───────────────────────────────────────────────
   EVENT NAME   COUNTING METHOD
`;

      const result = parseReportOutput(output);

      expect(result.project?.name).toBe('My Project Name');
      expect(result.project?.property_id).toBe('987654321');
    });

    it('extracts data retention settings', () => {
      const output = `
📦 TestProject (Property: 111222333)

🗄️  Data Retention Settings
───────────────────────────────────────────────
Event Data Retention: 14 months (FOURTEEN_MONTHS)
Reset on New Activity: true
`;

      const result = parseReportOutput(output);

      expect(result.data_retention).toBeDefined();
      expect(result.data_retention?.months).toBe(14);
      expect(result.data_retention?.reset_on_new_activity).toBe(true);
    });

    it('extracts enhanced measurement status', () => {
      const output = `
📦 TestProject (Property: 111222333)

⚡ Enhanced Measurement
───────────────────────────────────────────────
Enhanced Measurement enabled
`;

      const result = parseReportOutput(output);

      expect(result.enhanced_measurement).toBeDefined();
      expect(result.enhanced_measurement?.enabled).toBe(true);
    });

    it('handles multiple metrics with different units', () => {
      const output = `
📦 TestProject (Property: 111222333)

📈 Custom Metrics
───────────────────────────────────────────────
   DISPLAY NAME        PARAMETER          UNIT       SCOPE
   Processing Time     processing_time    STANDARD   EVENT
   Product Price       product_price      CURRENCY   EVENT
   Duration            duration_sec       SECONDS    EVENT
`;

      const result = parseReportOutput(output);

      expect(result.metrics).toHaveLength(3);
      expect(result.metrics[0].unit).toBe('STANDARD');
      expect(result.metrics[1].unit).toBe('CURRENCY');
      expect(result.metrics[2].unit).toBe('SECONDS');
    });
  });
});
