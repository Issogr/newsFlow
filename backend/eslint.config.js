const { createNodeEslintConfig } = require('../scripts/eslintNodeBase.cjs');

module.exports = createNodeEslintConfig({
  ignores: ['logs/**']
});
