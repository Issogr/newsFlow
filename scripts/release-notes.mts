import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_CHANGELOG_ENTRY } from '../frontend/src/config/changelog.ts';

export function getReleaseNotes(changelog: string, entry: { id: string; date: string }, commitMessage?: string) {
  const { id, date } = entry;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date
    || !/^\d{4}-\d{2}-\d{2}-(?:0[1-9]|[1-9]\d)$/.test(id)
    || !id.startsWith(`${date}-`)) {
    throw new Error('Finalize the changelog date (YYYY-MM-DD) and ID (YYYY-MM-DD-NN, starting at 01) before publishing.');
  }

  const [, section = ''] = changelog.split(/^## /m);
  const [heading, ...lines] = section.split(/\r?\n/);
  const notes = lines.join('\n').trim();
  if (heading !== id || !/^- \S/m.test(notes)) {
    throw new Error(`The first CHANGELOG.md section must be "## ${id}" with release notes. Finalize Unreleased before publishing.`);
  }

  if (commitMessage !== undefined && commitMessage.split(/\r?\n/, 1)[0] !== `Prepared update ${id}`) {
    throw new Error(`The release commit title must be exactly "Prepared update ${id}" and match the finalized changelog ID.`);
  }

  return { tag: `update-${id}`, title: `News Flow — ${id}`, notes };
}

if (import.meta.main) {
  const release = getReleaseNotes(
    readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'),
    CURRENT_CHANGELOG_ENTRY,
    process.env.RELEASE_COMMIT_MESSAGE,
  );
  if (process.env.GITHUB_OUTPUT && process.env.RUNNER_TEMP) {
    const notesFile = join(process.env.RUNNER_TEMP, 'newsflow-release-notes.md');
    writeFileSync(notesFile, `${release.notes}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${release.tag}\ntitle=${release.title}\nnotes_file=${notesFile}\n`);
  }
  console.log(`${release.title}\n\n${release.notes}`);
}
