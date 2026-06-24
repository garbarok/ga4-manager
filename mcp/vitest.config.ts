import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run tests from source. Without this, the compiled copies under
    // dist/ (produced by `npm run build`) are discovered and run too,
    // doubling the suite and double-counting failures.
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        'vitest.config.ts'
      ]
    }
  }
});
