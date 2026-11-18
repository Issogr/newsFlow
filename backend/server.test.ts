import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

test('an occupied port exits before opening SQLite or starting jobs', async () => {
  const portOwner = createServer();
  const dir = mkdtempSync(join(tmpdir(), 'newsflow-bind-'));
  const db = join(dir, 'news.db');
  try {
    await new Promise<void>((resolve) => portOwner.listen(0, resolve));
    const address = portOwner.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    await expect(promisify(execFile)(process.execPath, ['--require', 'tsx/cjs', 'server.ts'], {
      env: { ...process.env, PORT: String(address.port), NODE_ENV: 'production', NEWS_DB_PATH: db, OPENROUTER_API_KEY: '' },
      timeout: 4000
    })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('EADDRINUSE') });
    expect(existsSync(db)).toBe(false);
  } finally {
    portOwner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
