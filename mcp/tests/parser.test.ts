import { describe, it, expect } from 'vitest';
import { OutputParser } from '../src/cli/parser';

describe('OutputParser', () => {
  const parser = new OutputParser();

  describe('Format Detection', () => {
    it('should detect JSON format', () => {
      const jsonOutput = '{"key": "value"}';
      const result = parser.parse(jsonOutput);
      expect(result.format).toBe('json');
    });

    it('should detect JSON array format', () => {
      const jsonOutput = '[{"key": "value"}]';
      const result = parser.parse(jsonOutput);
      expect(result.format).toBe('json');
    });

    it('should detect table format with box-drawing characters', () => {
      const tableOutput = `
┌──────┬───────┐
│ Name │ Value │
├──────┼───────┤
│ Test │ 123   │
└──────┴───────┘
      `.trim();
      const result = parser.parse(tableOutput);
      expect(result.format).toBe('table');
    });

    it('should detect table format with ASCII borders', () => {
      const tableOutput = `
+------+-------+
| Name | Value |
+------+-------+
| Test | 123   |
+------+-------+
      `.trim();
      const result = parser.parse(tableOutput);
      expect(result.format).toBe('table');
    });

    it('should detect CSV format', () => {
      const csvOutput = 'Name,Value\nTest,123';
      const result = parser.parse(csvOutput);
      expect(result.format).toBe('csv');
    });

    it('should detect markdown table format', () => {
      const markdownOutput = `
| Name  | Value |
|-------|-------|
| Test  | 123   |
      `.trim();
      const result = parser.parse(markdownOutput);
      expect(result.format).toBe('markdown');
    });

    it('should default to text format for unrecognized content', () => {
      const textOutput = 'Just some plain text';
      const result = parser.parse(textOutput);
      expect(result.format).toBe('text');
    });

    it('should handle empty output', () => {
      const result = parser.parse('');
      expect(result.format).toBe('text');
      expect(result.data).toBe('');
    });
  });

  describe('JSON Parsing', () => {
    it('should parse simple JSON object', () => {
      const jsonOutput = '{"name": "test", "value": 123}';
      const result = parser.parse(jsonOutput);

      expect(result.format).toBe('json');
      expect(result.data).toEqual({ name: 'test', value: 123 });
    });

    it('should parse JSON array', () => {
      const jsonOutput = '[{"id": 1}, {"id": 2}]';
      const result = parser.parse(jsonOutput);

      expect(result.format).toBe('json');
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should parse nested JSON', () => {
      const jsonOutput = '{"user": {"name": "John", "age": 30}}';
      const result = parser.parse(jsonOutput);

      expect(result.format).toBe('json');
      expect(result.data).toEqual({ user: { name: 'John', age: 30 } });
    });
  });

  describe('Table Parsing', () => {
    it('should parse table with box-drawing characters', () => {
      const tableOutput = `
┌─────────────┬───────┬──────┐
│ Name        │ Value │ Type │
├─────────────┼───────┼──────┤
│ Test Item   │ 123   │ A    │
│ Another     │ 456   │ B    │
└─────────────┴───────┴──────┘
      `.trim();

      const result = parser.parse(tableOutput);

      expect(result.format).toBe('table');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        'Name': 'Test Item',
        'Value': 123,
        'Type': 'A'
      });
      expect(result.data[1]).toEqual({
        'Name': 'Another',
        'Value': 456,
        'Type': 'B'
      });
    });

    it('should parse table with ASCII borders', () => {
      const tableOutput = `
+------+-------+
| Name | Value |
+------+-------+
| Test | 123   |
+------+-------+
      `.trim();

      const result = parser.parse(tableOutput);

      expect(result.format).toBe('table');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        'Name': 'Test',
        'Value': 123
      });
    });

    it('should handle empty table', () => {
      const tableOutput = `
┌──────┬───────┐
│ Name │ Value │
└──────┴───────┘
      `.trim();

      const result = parser.parse(tableOutput);

      expect(result.format).toBe('table');
      expect(result.data).toHaveLength(0);
    });

    it('should parse numbers correctly', () => {
      const tableOutput = `
┌──────┬───────┬───────┐
│ Name │ Count │ Price │
├──────┼───────┼───────┤
│ Item │ 1,234 │ 99.99 │
└──────┴───────┴───────┘
      `.trim();

      const result = parser.parse(tableOutput);

      expect(result.data[0].Count).toBe(1234); // Thousand separators removed
      expect(result.data[0].Price).toBe(99.99);
    });
  });

  describe('CSV Parsing', () => {
    it('should parse simple CSV', () => {
      const csvOutput = 'Name,Value\nTest,123\nAnother,456';
      const result = parser.parse(csvOutput);

      expect(result.format).toBe('csv');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({ Name: 'Test', Value: '123' });
      expect(result.data[1]).toEqual({ Name: 'Another', Value: '456' });
    });

    it('should handle CSV with quoted fields', () => {
      const csvOutput = 'Name,Description\n"Test","Has, comma"\n"Another","Normal"';
      const result = parser.parse(csvOutput);

      expect(result.format).toBe('csv');
      expect(result.data[0]).toEqual({ Name: 'Test', Description: 'Has, comma' });
    });

    it('should skip empty lines in CSV', () => {
      const csvOutput = 'Name,Value\nTest,123\n\nAnother,456\n';
      const result = parser.parse(csvOutput);

      expect(result.format).toBe('csv');
      expect(result.data).toHaveLength(2);
    });
  });

  describe('Markdown Parsing', () => {
    it('should parse markdown table', () => {
      const markdownOutput = `
| Name  | Value | Type |
|-------|-------|------|
| Test  | 123   | A    |
| Other | 456   | B    |
      `.trim();

      const result = parser.parse(markdownOutput);

      expect(result.format).toBe('markdown');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        'Name': 'Test',
        'Value': 123,
        'Type': 'A'
      });
    });

    it('should handle markdown table with empty cells', () => {
      const markdownOutput = `
| Name  | Value |
|-------|-------|
| Test  |       |
|       | 456   |
      `.trim();

      const result = parser.parse(markdownOutput);

      expect(result.data[0]).toEqual({ 'Name': 'Test', 'Value': '' });
      expect(result.data[1]).toEqual({ 'Name': '', 'Value': 456 });
    });

    it('should parse numbers and booleans in markdown', () => {
      const markdownOutput = `
| Name  | Count | Active |
|-------|-------|--------|
| Test  | 123   | true   |
| Other | 0     | false  |
      `.trim();

      const result = parser.parse(markdownOutput);

      expect(result.data[0].Count).toBe(123);
      expect(result.data[0].Active).toBe(true);
      expect(result.data[1].Active).toBe(false);
    });
  });

  describe('Value Parsing', () => {
    it('should parse integers', () => {
      const tableOutput = `
┌───────┐
│ Value │
├───────┤
│ 123   │
└───────┘
      `.trim();

      const result = parser.parse(tableOutput);
      expect(result.data[0].Value).toBe(123);
      expect(typeof result.data[0].Value).toBe('number');
    });

    it('should parse floats', () => {
      const tableOutput = `
┌───────┐
│ Value │
├───────┤
│ 123.45│
└───────┘
      `.trim();

      const result = parser.parse(tableOutput);
      expect(result.data[0].Value).toBe(123.45);
    });

    it('should parse booleans', () => {
      const tableOutput = `
┌────────┬───────┐
│ True   │ False │
├────────┼───────┤
│ true   │ false │
└────────┴───────┘
      `.trim();

      const result = parser.parse(tableOutput);
      expect(result.data[0].True).toBe(true);
      expect(result.data[0].False).toBe(false);
    });

    it('should keep strings as strings', () => {
      const tableOutput = `
┌──────┐
│ Text │
├──────┤
│ abc  │
└──────┘
      `.trim();

      const result = parser.parse(tableOutput);
      expect(result.data[0].Text).toBe('abc');
      expect(typeof result.data[0].Text).toBe('string');
    });

    it('should handle numbers with thousand separators', () => {
      const tableOutput = `
┌─────────┐
│ Value   │
├─────────┤
│ 1,234   │
└─────────┘
      `.trim();

      const result = parser.parse(tableOutput);
      expect(result.data[0].Value).toBe(1234);
    });
  });

  describe('Error Handling', () => {
    it('should return text format for invalid JSON', () => {
      const invalidJson = '{invalid json}';
      const result = parser.parse(invalidJson);

      expect(result.format).toBe('text');
      expect(result.parseError).toBeDefined();
    });

    it('should handle malformed tables gracefully', () => {
      const malformedTable = '│ Name │ Value │';
      const result = parser.parse(malformedTable);

      expect(result.format).toBe('table');
      expect(result.data).toHaveLength(0);
    });
  });

  describe('Clean Output', () => {
    it('should remove structured log lines', () => {
      const outputWithLogs = `
time=2024-12-27T10:30:00Z level=INFO msg="Starting"
Actual output here
time=2024-12-27T10:30:01Z level=INFO msg="Done"
More output
      `.trim();

      const cleaned = parser.cleanOutput(outputWithLogs);

      expect(cleaned).not.toContain('time=');
      expect(cleaned).not.toContain('level=');
      expect(cleaned).toContain('Actual output here');
      expect(cleaned).toContain('More output');
    });

    it('should preserve non-log lines', () => {
      const output = 'Line 1\nLine 2\nLine 3';
      const cleaned = parser.cleanOutput(output);

      expect(cleaned).toBe(output);
    });
  });

  describe('Real-World Examples', () => {
    it('should parse GA4 report table output', () => {
      const ga4ReportOutput = `
┌─────────────────────┬──────────────────────┬───────┐
│ Event Name          │ Counting Method      │ Count │
├─────────────────────┼──────────────────────┼───────┤
│ download_image      │ ONCE_PER_EVENT       │ 1,234 │
│ compression_complete│ ONCE_PER_SESSION     │ 567   │
└─────────────────────┴──────────────────────┴───────┘
      `.trim();

      const result = parser.parse(ga4ReportOutput);

      expect(result.format).toBe('table');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        'Event Name': 'download_image',
        'Counting Method': 'ONCE_PER_EVENT',
        'Count': 1234
      });
    });

    it('should parse GSC analytics JSON output', () => {
      const gscJsonOutput = JSON.stringify({
        period: '2024-11-27 to 2024-12-27',
        site_url: 'sc-domain:example.com',
        total_rows: 2,
        aggregates: {
          total_clicks: 100,
          total_impressions: 1000,
          average_ctr: 0.1,
          average_position: 5.5
        },
        rows: [
          { keys: ['query1'], clicks: 50, impressions: 500, ctr: 0.1, position: 5.0 },
          { keys: ['query2'], clicks: 50, impressions: 500, ctr: 0.1, position: 6.0 }
        ]
      });

      const result = parser.parse(gscJsonOutput);

      expect(result.format).toBe('json');
      expect(result.data.total_rows).toBe(2);
      expect(result.data.rows).toHaveLength(2);
    });

    it('should parse GSC analytics CSV output', () => {
      const gscCsvOutput = `Query,Page,Clicks,Impressions,CTR,Position
best image compressor,https://example.com/,45,500,0.09,3.2
free image optimizer,https://example.com/blog/,30,400,0.075,4.1`;

      const result = parser.parse(gscCsvOutput);

      expect(result.format).toBe('csv');
      expect(result.data).toHaveLength(2);
      expect(result.data[0].Query).toBe('best image compressor');
    });
  });
});
