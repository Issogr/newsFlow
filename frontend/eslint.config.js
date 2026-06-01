const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.js', 'vite.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        AbortController: 'readonly',
        Blob: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        HTMLElement: 'readonly',
        HTMLMediaElement: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        cancelAnimationFrame: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        globalThis: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        process: 'readonly',
        requestAnimationFrame: 'readonly',
        require: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', {
        args: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^React$'
      }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
    },
  },
];
