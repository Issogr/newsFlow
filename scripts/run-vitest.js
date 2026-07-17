#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const vitestPackagePath = projectRequire.resolve('vitest/package.json');
const vitestBinPath = path.join(path.dirname(vitestPackagePath), 'vitest.mjs');
const userArgs = process.argv.slice(2);
const normalizedArgs = [];
const packageDirectoryName = path.basename(process.cwd());

for (let index = 0; index < userArgs.length; index += 1) {
  const arg = userArgs[index];

  if (arg === '--runTestsByPath' || arg === '--runInBand') {
    continue;
  }

  normalizedArgs.push(
    !arg.startsWith('-') && arg.startsWith(`${packageDirectoryName}/`)
      ? arg.slice(packageDirectoryName.length + 1)
      : arg
  );
}

const shouldRunOnce = !normalizedArgs.includes('--watch') && !normalizedArgs.includes('--ui');
const vitestArgs = shouldRunOnce ? ['run', ...normalizedArgs] : normalizedArgs;
const result = spawnSync(process.execPath, ['--no-experimental-webstorage', vitestBinPath, ...vitestArgs], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status === null ? 1 : result.status);
