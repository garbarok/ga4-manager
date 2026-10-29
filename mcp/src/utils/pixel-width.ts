// Arial 13px character width table. Default 8px for unmapped chars.
const WIDTHS: Record<string, number> = {
  // Uppercase
  A: 9, B: 8, C: 8, D: 9, E: 7, F: 7, G: 9, H: 9, I: 3, J: 5,
  K: 8, L: 7, M: 10, N: 9, O: 9, P: 7, Q: 9, R: 8, S: 7, T: 7,
  U: 9, V: 8, W: 11, X: 8, Y: 7, Z: 8,
  // Lowercase
  a: 7, b: 7, c: 6, d: 7, e: 7, f: 4, g: 7, h: 7, i: 3, j: 3,
  k: 7, l: 3, m: 11, n: 7, o: 7, p: 7, q: 7, r: 4, s: 6, t: 5,
  u: 7, v: 6, w: 9, x: 6, y: 6, z: 6,
  // Digits
  '0': 7, '1': 7, '2': 7, '3': 7, '4': 7, '5': 7, '6': 7, '7': 7, '8': 7, '9': 7,
  // Common punctuation
  ' ': 3, '.': 4, ',': 4, ':': 4, ';': 4, '!': 4, '?': 7, '-': 4, '_': 7, '/': 4,
  '\\': 4, '(': 4, ')': 4, '[': 4, ']': 4, '{': 4, '}': 4, '+': 7, '=': 7, '<': 7,
  '>': 7, '|': 3, '"': 5, "'": 3, '`': 5, '^': 8, '~': 7, '#': 7, '%': 9, '&': 9,
  '*': 6, '@': 12, $: 7,
}

export function estimatePixelWidth(text: string): number {
  let total = 0
  for (const char of text) {
    total += WIDTHS[char] ?? 8
  }
  return total
}
