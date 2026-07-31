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

function createNodeEslintConfig({ ignores = [] } = {}) {
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
      files: ['**/*.js'],
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
      files: ['**/*.test.js'],
      languageOptions: {
        globals: testGlobals
      }
    }
  ];
}

module.exports = {
  createNodeEslintConfig
};
