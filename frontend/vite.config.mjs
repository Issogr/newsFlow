import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const bffOrigin = process.env.VITE_BFF_ORIGIN || 'http://localhost:80';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/public': {
        target: bffOrigin,
        changeOrigin: true
      },
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
    setupFiles: './src/setupTests.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/setupTests.js'],
      thresholds: {
        branches: 40,
        functions: 50,
        lines: 55,
        statements: 55
      }
    }
  }
});
