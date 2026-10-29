import { parse as parseCSV } from 'csv-parse/sync';
import type { ParsedOutput } from '../types/cli.js';

/**
 * Parses CLI output into structured data
 *
 * Supports multiple formats: JSON, table, CSV, markdown, and plain text
 */
export class OutputParser {
  /**
   * Parse CLI output into structured format
   *
   * Auto-detects format and delegates to specific parser
   *
   * @param output - Raw CLI output string
   * @returns Parsed output with detected format and structured data
   */
  parse(output: string): ParsedOutput {
    if (!output || output.trim().length === 0) {
      return { format: 'text', data: '' };
    }

    const format = this.detectFormat(output);

    try {
      switch (format) {
        case 'json':
          return { format: 'json', data: this.parseJSON(output) };
        case 'csv':
          return { format: 'csv', data: this.parseCSV(output) };
        case 'table':
          return { format: 'table', data: this.parseTable(output) };
        case 'markdown':
          return { format: 'markdown', data: this.parseMarkdown(output) };
        default:
          return { format: 'text', data: output };
      }
    } catch (error) {
      // If parsing fails, return as text
      return {
        format: 'text',
        data: output,
        parseError: error instanceof Error ? error.message : 'Unknown parse error'
      };
    }
  }

  /**
   * Detect output format based on content
   *
   * @param output - Raw output string
   * @returns Detected format
   */
  private detectFormat(output: string): 'json' | 'table' | 'csv' | 'markdown' | 'text' {
    const trimmed = output.trim();

    // JSON: starts with { or [
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return 'json';
    }

    // CSV: has commas and no table borders
    const lines = trimmed.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstLine = lines[0];

      // Markdown table: has | separators
      if (firstLine.includes('|') && lines.length > 1 && lines[1].includes('|-')) {
        return 'markdown';
      }

      // ASCII table: has ┌─┐ box drawing characters or +---+ borders
      if (firstLine.match(/[┌┬┐├┼┤└┴┘─│]/) || firstLine.match(/^\+[-+]+\+$/)) {
        return 'table';
      }

      // CSV: has commas but no table indicators
      if (firstLine.includes(',') && !firstLine.includes('|')) {
        return 'csv';
      }
    }

    return 'text';
  }

  /**
   * Parse JSON output
   *
   * @param output - JSON string
   * @returns Parsed JSON object
   */
  private parseJSON(output: string): any {
    return JSON.parse(output.trim());
  }

  /**
   * Parse CSV output
   *
   * Uses csv-parse library for robust CSV parsing
   *
   * @param output - CSV string
   * @returns Array of row objects
   */
  private parseCSV(output: string): Array<Record<string, string>> {
    const records = parseCSV(output, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Array<Record<string, string>>;

    return records;
  }

  /**
   * Parse ASCII table output from tablewriter
   *
   * Handles both box-drawing characters (┌┬┐) and ASCII borders (+--+)
   *
   * Example table:
   * ┌─────────┬──────┐
   * │ Name    │ Value│
   * ├─────────┼──────┤
   * │ Test    │ 123  │
   * └─────────┴──────┘
   *
   * @param output - Table string
   * @returns Array of row objects
   */
  private parseTable(output: string): Array<Record<string, any>> {
    const lines = output.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return [];
    }

    // Remove border lines (┌─┐, ├─┤, └─┘, +--+, etc.)
    const contentLines = lines.filter(line =>
      !line.match(/^[┌┬┐├┼┤└┴┘─│\s]+$/) &&
      !line.match(/^\+[-+]+\+$/)
    );

    if (contentLines.length < 2) {
      return [];
    }

    // Extract headers from first content line
    const headerLine = contentLines[0];
    const headers = this.extractTableCells(headerLine).map(h => h.trim());

    // Extract data rows
    const rows: Array<Record<string, any>> = [];
    for (let i = 1; i < contentLines.length; i++) {
      const values = this.extractTableCells(contentLines[i]);

      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        if (index < values.length) {
          row[header] = this.parseValue(values[index].trim());
        }
      });

      // Only add non-empty rows
      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Extract cell values from a table row
   *
   * Handles both │ and | separators
   *
   * @param line - Table row line
   * @returns Array of cell values
   */
  private extractTableCells(line: string): string[] {
    // Remove leading/trailing borders
    let cleaned = line.replace(/^[│|]\s*/, '').replace(/\s*[│|]$/, '');

    // Split by │ or |
    const cells = cleaned.split(/\s*[│|]\s*/);

    return cells;
  }

  /**
   * Parse markdown table output
   *
   * Example:
   * | Name  | Value |
   * |-------|-------|
   * | Test  | 123   |
   *
   * @param output - Markdown table string
   * @returns Array of row objects
   */
  private parseMarkdown(output: string): Array<Record<string, any>> {
    const lines = output.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length < 3) { // Need header, separator, and at least one data row
      return [];
    }

    // Extract header (first line)
    const headerLine = lines[0];
    const headers = headerLine
      .split('|')
      .map(h => h.trim())
      .filter(h => h.length > 0);

    // Skip separator line (second line with |---|---|)
    // Parse data rows (from line 2 onwards)
    const rows: Array<Record<string, any>> = [];
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];

      // Skip separator lines
      if (line.includes('|-')) {
        continue;
      }

      const values = line
        .split('|')
        .map(v => v.trim())
        .filter((v, idx, arr) => {
          // Filter out empty strings from leading/trailing pipes
          // But keep middle empty values
          return idx > 0 && idx < arr.length - 1;
        });

      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        if (index < values.length) {
          row[header] = this.parseValue(values[index]);
        }
      });

      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Parse a value string into appropriate type
   *
   * Attempts to convert to number or boolean, otherwise returns string
   *
   * @param value - String value
   * @returns Parsed value (number, boolean, or string)
   */
  private parseValue(value: string): string | number | boolean {
    // Empty or whitespace
    if (!value || value.trim().length === 0) {
      return '';
    }

    const trimmed = value.trim();

    // Boolean
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;

    // Number (integer or float)
    const num = Number(trimmed.replace(/,/g, '')); // Remove thousand separators
    if (!isNaN(num) && trimmed.match(/^-?[\d,]+\.?\d*$/)) {
      return num;
    }

    // String (default)
    return trimmed;
  }

  /**
   * Clean output by removing log lines and other noise
   *
   * Removes lines that start with:
   * - time= (structured logs)
   * - level= (structured logs)
   * - Emoji indicators at start of line
   *
   * @param output - Raw output
   * @returns Cleaned output
   */
  cleanOutput(output: string): string {
    const lines = output.split('\n');
    const cleaned = lines.filter(line => {
      const trimmed = line.trim();

      // Remove structured log lines
      if (trimmed.startsWith('time=') || trimmed.match(/^time=.+level=/)) {
        return false;
      }

      // Keep all other lines
      return true;
    });

    return cleaned.join('\n');
  }
}
