const fs = require('fs');
const os = require('os');
const path = require('path');

function setupTempNewsDb(prefix = 'news-db-test-') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'news.db');
  process.env.NEWS_DB_PATH = dbPath;
  return { tempDir, dbPath };
}

function cleanupTempNewsDb(tempDb = {}, database = null) {
  database?.closeDb?.();
  delete process.env.NEWS_DB_PATH;

  if (tempDb.tempDir) {
    fs.rmSync(tempDb.tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  cleanupTempNewsDb,
  setupTempNewsDb
};
