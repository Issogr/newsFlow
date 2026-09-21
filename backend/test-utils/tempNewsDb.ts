import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface TempNewsDb {
  tempDir: string;
  dbPath: string;
}

interface CloseableDatabase {
  closeDb?: () => void;
}

function setupTempNewsDb(prefix = 'news-db-test-'): TempNewsDb {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'news.db');
  process.env.NEWS_DB_PATH = dbPath;
  return { tempDir, dbPath };
}

function cleanupTempNewsDb(
  tempDb: Partial<TempNewsDb> = {},
  database: CloseableDatabase | null = null
): void {
  database?.closeDb?.();
  delete process.env.NEWS_DB_PATH;

  if (tempDb.tempDir) {
    fs.rmSync(tempDb.tempDir, { recursive: true, force: true });
  }
}

export default {
  cleanupTempNewsDb,
  setupTempNewsDb
};
