#!/usr/bin/env node

const { spawnSync } = require('child_process');

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
const commandArgs = shouldRunOnce
  ? ['vitest', 'run', ...normalizedArgs]
  : ['vitest'];

const result = spawnSync('npx', commandArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

process.exit(result.status === null ? 1 : result.status);
