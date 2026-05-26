#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const WEBSTORAGE_FLAG = '--no-experimental-webstorage';

function supportsNodeFlag(flag) {
  const result = spawnSync(process.execPath, [flag, '--version'], {
    stdio: 'ignore'
  });

  return result.status === 0;
}

const args = process.argv.slice(2);
const normalizedArgs = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === '--runTestsByPath') {
    continue;
  }

  normalizedArgs.push(arg);
}

const shouldRunOnce = !normalizedArgs.includes('--watch') && !normalizedArgs.includes('--ui');
const vitestArgs = shouldRunOnce ? ['run', ...normalizedArgs] : [];
const vitestPackagePath = require.resolve('vitest/package.json');
const vitestBinPath = path.join(path.dirname(vitestPackagePath), 'vitest.mjs');
const nodeArgs = supportsNodeFlag(WEBSTORAGE_FLAG) ? [WEBSTORAGE_FLAG] : [];

const result = spawnSync(process.execPath, [...nodeArgs, vitestBinPath, ...vitestArgs], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status === null ? 1 : result.status);
