const nodeGlobals = {
  Buffer: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly'
};

const testGlobals = {
  afterAll: 'readonly',
  afterEach: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  jest: 'readonly',
  test: 'readonly'
};

function createNodeEslintConfig({ ignores = [] }: { ignores?: string[] } = {}) {
  return [
    {
      ignores: [
        'coverage/**',
        'data/**',
        'node_modules/**',
        ...ignores
      ]
    },
    {
      files: ['**/*.ts'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'commonjs',
        globals: nodeGlobals
      },
      rules: {
        'no-undef': 'error',
        'no-unused-vars': ['error', {
          args: 'none',
          ignoreRestSiblings: true
        }]
      }
    },
    {
      files: ['**/*.test.ts'],
      languageOptions: {
        globals: testGlobals
      }
    }
  ];
}

module.exports = {
  createNodeEslintConfig
};
