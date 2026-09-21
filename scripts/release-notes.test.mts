import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getReleaseNotes } from './release-notes.mts';

function createRepository(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), 'newsflow-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  const commit = (subject: string) => {
    git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', subject);
    return git('rev-parse', 'HEAD');
  };
  return { cwd, git, commit };
}

test('includes every commit since the published tag, including changes from skipped or failed releases', (t) => {
  const { cwd, git, commit } = createRepository(t);
  const previous = commit('Already released');
  git('tag', 'update-2026-09-21-01');
  const first = commit('Center story circles');
  const second = commit('Support [news] <tags> and @readers');
  // A tag without a published release must not become the baseline.
  git('tag', `update-${second}`);
  const release = getReleaseNotes({ cwd, base: 'update-2026-09-21-01', repository: 'owner/newsflow', date: '2026-09-22' })!;

  assert.deepEqual(release, {
    tag: `update-${second}`,
    title: `News Flow — 2026-09-22 (${second.slice(0, 7)})`,
    notes: `## Changes\n\n- Center story circles ([${first.slice(0, 7)}](https://github.com/owner/newsflow/commit/${first}))\n- Support \\[news\\] \\<tags\\> and \\@readers ([${second.slice(0, 7)}](https://github.com/owner/newsflow/commit/${second}))\n\n[Full changes](https://github.com/owner/newsflow/compare/${previous}...${second})`,
    metadata: { id: second, date: '2026-09-22', url: `https://github.com/owner/newsflow/releases/tag/update-${second}` },
  });
  assert.match(getReleaseNotes({ cwd })!.notes, /Already released/);
  assert.match(getReleaseNotes({ cwd })!.notes, new RegExp(`/commits/${second}`));
  assert.equal(getReleaseNotes({ cwd, base: `update-${second}` }), null);
  assert.equal(release.metadata.id.length, 40); // Existing acknowledgement field limit.
});

test('rejects divergent release history, conflicting tags, and invalid metadata', (t) => {
  const { cwd, git, commit } = createRepository(t);
  const base = commit('Initial');
  const latest = commit('Published change');
  git('switch', '-qc', 'divergent', base);
  const divergent = commit('Different history');
  assert.throws(() => getReleaseNotes({ cwd, base: latest, ref: divergent }), /not an ancestor/);
  git('tag', `update-${latest}`, base);
  assert.throws(() => getReleaseNotes({ cwd, base, ref: latest }), /points to another commit/);
  assert.throws(() => getReleaseNotes({ cwd, repository: '../bad' }), /owner\/name/);
  assert.throws(() => getReleaseNotes({ cwd, date: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => getReleaseNotes({ cwd, base: 'missing-release' }));
});

test('writes matching image metadata and Actions outputs, then skips an already published commit', (t) => {
  const { cwd, git, commit } = createRepository(t);
  commit('Previous release');
  git('tag', 'previous');
  const sha = commit('Next release');
  const metadataPath = join(cwd, 'frontend/src/config/release.json');
  mkdirSync(join(cwd, 'frontend/src/config'), { recursive: true });
  const outputPath = join(cwd, 'actions-output');
  const run = (base: string) => execFileSync(process.execPath, [
    fileURLToPath(new URL('./release-notes.mts', import.meta.url)),
    '--base', base, '--ref', sha, '--repository', 'owner/newsflow', '--write',
  ], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputPath, RUNNER_TEMP: cwd } });

  run('previous');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  assert.equal(metadata.id, sha);
  assert.equal(metadata.url, `https://github.com/owner/newsflow/releases/tag/update-${sha}`);
  assert.match(metadata.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(readFileSync(outputPath, 'utf8'), new RegExp(`publish=true\ntag=update-${sha}\n`));
  assert.match(readFileSync(join(cwd, 'newsflow-release-notes.md'), 'utf8'), /Next release/);
  assert.doesNotMatch(readFileSync(join(cwd, 'newsflow-release-notes.md'), 'utf8'), /Previous release/);

  git('tag', `update-${sha}`);
  writeFileSync(outputPath, '');
  run(`update-${sha}`);
  assert.equal(readFileSync(outputPath, 'utf8'), 'publish=false\n');
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, 'utf8')), metadata);
});
