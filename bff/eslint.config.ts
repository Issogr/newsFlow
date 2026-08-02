const tseslint: typeof import('typescript-eslint') = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['coverage/**', 'data/**', 'dist/**', 'node_modules/**', 'public/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
);
