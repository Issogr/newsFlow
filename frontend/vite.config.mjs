import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

const backendOrigin = process.env.VITE_BACKEND_ORIGIN || 'http://localhost:5000';

function transformFrontendJsx() {
  return {
    name: 'transform-frontend-jsx',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.includes('/src/') || !id.endsWith('.js')) {
        return null;
      }

      return transformWithOxc(code, id, {
        lang: 'jsx',
        jsx: {
          runtime: 'automatic'
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [transformFrontendJsx(), react()],
  server: {
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true
      },
      '/socket.io': {
        target: backendOrigin,
        changeOrigin: true,
        ws: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js'
  }
});
