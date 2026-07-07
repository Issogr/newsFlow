import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['../scripts/vitest-jest-compat.mjs'],
    coverage: {
      provider: 'v8',
      include: ['server.js', 'config/**/*.js', 'routes/**/*.js', 'services/**/*.js', 'utils/**/*.js'],
      exclude: ['**/*.test.js', 'test-utils/**'],
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
