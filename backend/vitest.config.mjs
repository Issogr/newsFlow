import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['../scripts/vitest-jest-compat.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 40,
        functions: 60,
        lines: 60,
        statements: 60
      }
    }
  }
});
