import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const bffOrigin = process.env.VITE_BFF_ORIGIN || 'http://localhost:80';

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
  plugins: [transformFrontendJsx(), react(), tailwindcss()],
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
    setupFiles: './src/setupTests.js'
  }
});
