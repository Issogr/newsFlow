const nodeGlobals = {
  Buffer: 'readonly',
  Uint8Array: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
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
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  jest: 'readonly',
  test: 'readonly',
  vi: 'readonly'
};

function createNodeEslintConfig({ ignores = [], globals = {}, tests = ['**/*.test.js'] } = {}) {
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
        globals: {
          ...nodeGlobals,
          ...globals
        }
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
      files: tests,
      languageOptions: {
        globals: testGlobals
      }
    }
  ];
}

module.exports = {
  createNodeEslintConfig
};
