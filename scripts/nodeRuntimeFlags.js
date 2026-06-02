const { spawnSync } = require('child_process');

const WEBSTORAGE_FLAG = '--no-experimental-webstorage';

function supportsNodeFlag(flag) {
  const result = spawnSync(process.execPath, [flag, '--version'], {
    stdio: 'ignore'
  });

  return result.status === 0;
}

function getStableNodeRuntimeArgs() {
  return supportsNodeFlag(WEBSTORAGE_FLAG) ? [WEBSTORAGE_FLAG] : [];
}

module.exports = {
  getStableNodeRuntimeArgs
};
