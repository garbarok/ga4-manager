import { describe, it, expect } from 'vitest';
import {
  ga4ValidateInputSchema,
  buildValidateArgs,
  parseValidateOutput,
  GA4ValidateInput,
} from './ga4-validate';

describe('ga4_validate tool', () => {
  describe('input schema validation', () => {
    it('accepts config_file input', () => {
      const input = { config_file: 'configs/my-project.yaml' };
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts all flag input', () => {
      const input = { all: true };
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('accepts verbose with config_file', () => {
      const input = { config_file: 'configs/test.yaml', verbose: true };
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.verbose).toBe(true);
      }
    });

    it('accepts verbose with all flag', () => {
      const input = { all: true, verbose: true };
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects empty input', () => {
      const input = {};
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects verbose alone without config specifier', () => {
      const input = { verbose: true };
      const result = ga4ValidateInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('buildValidateArgs', () => {
    it('builds args for config_file', () => {
      const input: GA4ValidateInput = { config_file: 'configs/my-project.yaml' };
      const args = buildValidateArgs(input);
      expect(args).toEqual(['configs/my-project.yaml']);
    });

    it('builds args for all flag', () => {
      const input: GA4ValidateInput = { all: true };
      const args = buildValidateArgs(input);
      expect(args).toEqual(['--all']);
    });

    it('includes verbose flag when true', () => {
      const input: GA4ValidateInput = { config_file: 'test.yaml', verbose: true };
      const args = buildValidateArgs(input);
      expect(args).toContain('--verbose');
      expect(args).toContain('test.yaml');
    });

    it('excludes verbose flag when false or undefined', () => {
      const input: GA4ValidateInput = { config_file: 'test.yaml', verbose: false };
      const args = buildValidateArgs(input);
      expect(args).not.toContain('--verbose');
    });

    it('prioritizes all flag over config_file', () => {
      const input: GA4ValidateInput = { all: true, config_file: 'test.yaml' };
      const args = buildValidateArgs(input);
      expect(args).toEqual(['--all']);
    });
  });

  describe('parseValidateOutput', () => {
    it('parses successful single file validation', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/examples/basic-ecommerce.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... OK
  -> Checking tier limits... OK

Valid configuration

===================================================
Validation Results: 1 total, 1 valid, 0 invalid

All configuration files are valid!
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.total_files).toBe(1);
      expect(result.valid_files).toBe(1);
      expect(result.invalid_files).toBe(0);
      expect(result.results.length).toBe(1);
      expect(result.results[0].valid).toBe(true);
      expect(result.results[0].yaml_syntax).toBe('ok');
      expect(result.results[0].config_structure).toBe('ok');
      expect(result.results[0].tier_limits).toBe('ok');
    });

    it('parses YAML syntax failure', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/invalid.yaml
-----------------------------------------------
  -> Checking YAML syntax... FAILED

    Error at line 15:
      13 |   conversions:
      14 |     - name: test_event
    ->15 |       counting_method ONCE_PER_EVENT
      16 |

    Full error: yaml: line 15: could not find expected ':'

===================================================
Validation Results: 1 total, 0 valid, 1 invalid

Some files have validation errors
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.invalid_files).toBe(1);
      expect(result.results.length).toBe(1);
      expect(result.results[0].valid).toBe(false);
      expect(result.results[0].yaml_syntax).toBe('failed');
      expect(result.results[0].error).toContain("could not find expected ':'");
    });

    it('parses config structure failure', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/bad-structure.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... FAILED
    project.name is required

===================================================
Validation Results: 1 total, 0 valid, 1 invalid
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.results[0].valid).toBe(false);
      expect(result.results[0].yaml_syntax).toBe('ok');
      expect(result.results[0].config_structure).toBe('failed');
      expect(result.results[0].error).toBe('project.name is required');
    });

    it('parses tier limit warnings', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/large-config.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... OK
  -> Checking tier limits... WARNINGS
    ! Conversions: 30 exceeds limit of 25 for standard tier
    ! Dimensions: 55 exceeds limit of 50 for standard tier

Valid configuration

===================================================
Validation Results: 1 total, 1 valid, 0 invalid
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(true);
      expect(result.results[0].valid).toBe(true);
      expect(result.results[0].tier_limits).toBe('warnings');
      expect(result.results[0].warnings).toBeDefined();
      expect(result.results[0].warnings?.length).toBeGreaterThan(0);
    });

    it('parses multiple file validation', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/examples/basic-ecommerce.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... OK
  -> Checking tier limits... OK

Valid configuration

Validating: configs/examples/saas-product.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... OK
  -> Checking tier limits... OK

Valid configuration

Validating: configs/invalid.yaml
-----------------------------------------------
  -> Checking YAML syntax... FAILED

    Full error: yaml: line 5: did not find expected key

===================================================
Validation Results: 3 total, 2 valid, 1 invalid

Some files have validation errors
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.total_files).toBe(3);
      expect(result.valid_files).toBe(2);
      expect(result.invalid_files).toBe(1);
      expect(result.results.length).toBe(3);

      // First file valid
      expect(result.results[0].file_path).toBe('configs/examples/basic-ecommerce.yaml');
      expect(result.results[0].valid).toBe(true);

      // Second file valid
      expect(result.results[1].file_path).toBe('configs/examples/saas-product.yaml');
      expect(result.results[1].valid).toBe(true);

      // Third file invalid
      expect(result.results[2].file_path).toBe('configs/invalid.yaml');
      expect(result.results[2].valid).toBe(false);
    });

    it('parses verbose output with config summary', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/examples/basic-ecommerce.yaml
-----------------------------------------------
  -> Checking YAML syntax... OK
  -> Checking config structure... OK
  -> Checking tier limits... OK

  i Configuration Summary:
    Project: Basic E-commerce
    Property ID: 123456789
    Tier: Standard (GA4)
    Conversions: 5 / 25 limit
    Dimensions: 10 / 50 limit
    Metrics: 3 / 50 limit
    Calculated Metrics: 2
    Audiences: 4
    Cleanup Items: 2 conversions, 3 dimensions

Valid configuration

===================================================
Validation Results: 1 total, 1 valid, 0 invalid
`;

      const result = parseValidateOutput(output, true);

      expect(result.success).toBe(true);
      expect(result.verbose).toBe(true);
      expect(result.results[0].summary).toBeDefined();
      expect(result.results[0].summary?.project_name).toBe('Basic E-commerce');
      expect(result.results[0].summary?.property_id).toBe('123456789');
      expect(result.results[0].summary?.conversions_count).toBe(5);
      expect(result.results[0].summary?.dimensions_count).toBe(10);
      expect(result.results[0].summary?.metrics_count).toBe(3);
      expect(result.results[0].summary?.calculated_metrics_count).toBe(2);
      expect(result.results[0].summary?.audiences_count).toBe(4);
      expect(result.results[0].summary?.cleanup_conversions).toBe(2);
      expect(result.results[0].summary?.cleanup_dimensions).toBe(3);
    });

    it('handles file not found error', () => {
      const output = `
GA4 Config Validator
===================================================

Validating: configs/nonexistent.yaml
-----------------------------------------------
File not found

===================================================
Validation Results: 1 total, 0 valid, 1 invalid
`;

      const result = parseValidateOutput(output, false);

      expect(result.success).toBe(false);
      expect(result.results[0].valid).toBe(false);
      expect(result.results[0].error).toBe('File not found');
    });

    it('handles empty results gracefully', () => {
      const output = `
GA4 Config Validator
===================================================

No YAML config files found in configs/ directory
`;

      const result = parseValidateOutput(output, false);

      expect(result.results.length).toBe(0);
      expect(result.total_files).toBe(0);
    });
  });
});
