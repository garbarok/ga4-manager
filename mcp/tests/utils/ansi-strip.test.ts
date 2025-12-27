import { describe, it, expect } from 'vitest';
import { stripANSI } from '../../src/utils/ansi-strip';

describe('stripANSI', () => {
  it('should remove ANSI color codes', () => {
    const input = '\x1b[31mError:\x1b[0m Something went wrong';
    const expected = 'Error: Something went wrong';

    const result = stripANSI(input);

    expect(result).toBe(expected);
  });

  it('should remove multiple ANSI codes', () => {
    const input = '\x1b[1m\x1b[32mSuccess:\x1b[0m \x1b[33mOperation completed\x1b[0m';
    const expected = 'Success: Operation completed';

    const result = stripANSI(input);

    expect(result).toBe(expected);
  });

  it('should handle text without ANSI codes', () => {
    const input = 'Plain text without colors';

    const result = stripANSI(input);

    expect(result).toBe(input);
  });

  it('should remove ANSI cursor movement codes', () => {
    const input = '\x1b[2J\x1b[HCleared screen';
    const expected = 'Cleared screen';

    const result = stripANSI(input);

    expect(result).toBe(expected);
  });

  it('should handle empty string', () => {
    const result = stripANSI('');

    expect(result).toBe('');
  });

  it('should handle complex formatting with background colors', () => {
    const input = '\x1b[41m\x1b[37mWhite on Red\x1b[0m';
    const expected = 'White on Red';

    const result = stripANSI(input);

    expect(result).toBe(expected);
  });

  it('should preserve emojis and unicode characters', () => {
    const input = '\x1b[32m✓\x1b[0m Success \x1b[31m✗\x1b[0m Failed';
    const expected = '✓ Success ✗ Failed';

    const result = stripANSI(input);

    expect(result).toBe(expected);
  });
});
