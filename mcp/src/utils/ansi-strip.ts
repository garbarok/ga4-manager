/**
 * Strip ANSI escape codes from a string
 *
 * Removes ANSI color codes, cursor movement, and other terminal formatting
 * to get clean text output from CLI commands.
 *
 * @param text - Text potentially containing ANSI codes
 * @returns Clean text without ANSI codes
 */
export function stripANSI(text: string): string {
  // Regex to match ANSI escape sequences
  // \x1b is the escape character (ESC)
  // \[ starts the control sequence
  // [0-9;]* matches zero or more digits and semicolons (parameters)
  // [a-zA-Z] matches the final command letter
  const ansiRegex = /\x1b\[[0-9;]*[a-zA-Z]/g;

  return text.replace(ansiRegex, '');
}
