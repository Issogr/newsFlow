const path = require('path');
const { spawnSync } = require('child_process');
const { createRequire } = require('module');

const WEBSTORAGE_FLAG = '--no-experimental-webstorage';

function supportsNodeFlag(flag) {
  const result = spawnSync(process.execPath, [flag, '--version'], {
    stdio: 'ignore'
  });

  return result.status === 0;
}

const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
const jestPackagePath = projectRequire.resolve('jest/package.json');
const jestBinPath = path.join(path.dirname(jestPackagePath), 'bin/jest.js');
const nodeArgs = supportsNodeFlag(WEBSTORAGE_FLAG) ? [WEBSTORAGE_FLAG] : [];

const result = spawnSync(process.execPath, [...nodeArgs, jestBinPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status === null ? 1 : result.status);
