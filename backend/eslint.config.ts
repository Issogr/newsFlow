const { createNodeEslintConfig } = require('../scripts/eslintNodeBase.ts');
const tseslint: typeof import('typescript-eslint') = require('typescript-eslint');

module.exports = [
  ...createNodeEslintConfig({ ignores: ['dist/**', 'logs/**'] }),
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_'
      }]
    }
  }
];
