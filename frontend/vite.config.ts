import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const bffOrigin = process.env.VITE_BFF_ORIGIN || 'http://localhost:80';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: bffOrigin,
        changeOrigin: true
      },
      '/socket.io': {
        target: bffOrigin,
        changeOrigin: true,
        ws: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    setupFiles: './src/setupTests.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/setupTests.ts', 'src/test-utils/**'],
      thresholds: {
        branches: 40,
        functions: 50,
        lines: 55,
        statements: 55
      }
    }
  }
});
