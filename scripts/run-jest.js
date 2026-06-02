const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');
const { getStableNodeRuntimeArgs } = require('./nodeRuntimeFlags');

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const jestPackagePath = projectRequire.resolve('jest/package.json');
const jestBinPath = path.join(path.dirname(jestPackagePath), 'bin/jest.js');
const nodeArgs = getStableNodeRuntimeArgs();
const userArgs = process.argv.slice(2);
const hasCoverageArg = userArgs.some((arg) => arg === '--coverage' || arg.startsWith('--coverage=') || arg === '--collectCoverage' || arg.startsWith('--collectCoverage='));
const hasFocusedTestFile = userArgs.some((arg) => !arg.startsWith('-') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg));
const jestArgs = hasFocusedTestFile && !hasCoverageArg
  ? ['--coverage=false', ...userArgs]
  : userArgs;

const result = spawnSync(process.execPath, [...nodeArgs, jestBinPath, ...jestArgs], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status === null ? 1 : result.status);
