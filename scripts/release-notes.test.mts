import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReleaseNotes } from './release-notes.mts';

test('prepares one dated release containing changes from multiple commits', () => {
  const entry = { id: '2026-09-21-02', date: '2026-09-21' };
  const notes = '- Improved summaries.\n- Simplified podcast controls.';
  assert.deepEqual(getReleaseNotes(`# Changelog\n\n## ${entry.id}\n\n${notes}\n\n## 3.7.0\n\n- Old change.\n`, entry), {
    tag: 'update-2026-09-21-02',
    title: 'News Flow — 2026-09-21-02',
    notes
  });
  assert.equal(getReleaseNotes(`# Changelog\r\n\r\n## ${entry.id}\r\n\r\n- Windows newline.\r\n`, entry).notes, '- Windows newline.');

  for (const invalid of [
    { id: 'unreleased', date: '' },
    { id: '2026-02-30-01', date: '2026-02-30' },
    { id: '2026-09-20-01', date: entry.date },
    { id: '2026-09-21-00', date: entry.date },
    { id: `${entry.id}\ninjected=value`, date: entry.date }
  ]) {
    assert.throws(() => getReleaseNotes('', invalid), /Finalize the changelog/);
  }
  for (const changelog of [
    '## Unreleased\n\n- Pending.\n',
    `## 2026-09-21-01\n\n- Wrong announcement.\n\n## ${entry.id}\n\n${notes}`,
    `## ${entry.id}\n\n## 3.7.0\n\n- Old change.\n`
  ]) {
    assert.throws(() => getReleaseNotes(changelog, entry), /first CHANGELOG.md section/);
  }
});
