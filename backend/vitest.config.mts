import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['../scripts/vitest-jest-compat.mts'],
    coverage: {
      provider: 'v8',
      include: ['server.ts', 'config/**/*.ts', 'routes/**/*.ts', 'services/**/*.ts', 'utils/**/*.ts'],
      exclude: ['**/*.test.ts', 'test-utils/**'],
      reporter: ['text'],
      thresholds: {
        branches: 40,
        functions: 60,
        lines: 60,
        statements: 60
      }
    }
  }
});
