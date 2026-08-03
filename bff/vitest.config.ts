import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['server.ts', 'lib/**/*.ts'],
      reporter: ['text'],
      thresholds: {
        branches: 55,
        functions: 70,
        lines: 70,
        statements: 70
      }
    }
  }
});
