#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');
const { getStableNodeRuntimeArgs } = require('./nodeRuntimeFlags');

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const vitestPackagePath = projectRequire.resolve('vitest/package.json');
const vitestBinPath = path.join(path.dirname(vitestPackagePath), 'vitest.mjs');
const userArgs = process.argv.slice(2);
const normalizedArgs = [];

for (let index = 0; index < userArgs.length; index += 1) {
  const arg = userArgs[index];

  if (arg === '--runTestsByPath' || arg === '--runInBand') {
    continue;
  }

  normalizedArgs.push(arg);
}

const hasCoverageArg = normalizedArgs.some((arg) => arg === '--coverage' || arg.startsWith('--coverage='));
const hasFocusedTestFile = normalizedArgs.some((arg) => !arg.startsWith('-') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg));
const shouldRunOnce = !normalizedArgs.includes('--watch') && !normalizedArgs.includes('--ui');
const defaultCoverageArgs = shouldRunOnce && !hasCoverageArg && !hasFocusedTestFile ? ['--coverage'] : [];
const vitestArgs = shouldRunOnce ? ['run', ...defaultCoverageArgs, ...normalizedArgs] : normalizedArgs;
const nodeArgs = getStableNodeRuntimeArgs();

const result = spawnSync(process.execPath, [...nodeArgs, vitestBinPath, ...vitestArgs], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status === null ? 1 : result.status);
