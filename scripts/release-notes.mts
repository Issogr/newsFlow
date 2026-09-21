import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export function getReleaseNotes({
  base = '',
  ref = 'HEAD',
  repository = 'issogr/newsflow',
  date = new Date().toISOString().slice(0, 10),
  cwd = process.cwd(),
} = {}) {
  if (repository !== repository.trim() || !/^[a-z\d][a-z\d_.-]*\/[a-z\d][a-z\d_.-]*$/i.test(repository)) {
    throw new Error('Repository must be owner/name.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Release date must be YYYY-MM-DD.');
  }

  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const resolveCommit = (value: string) => git('rev-parse', '--verify', '--end-of-options', `${value}^{commit}`);
  const sha = resolveCommit(ref);
  const previousSha = base ? resolveCommit(base) : '';
  if (previousSha === sha) return null;
  if (previousSha) {
    try {
      git('merge-base', '--is-ancestor', previousSha, sha);
    } catch {
      throw new Error('The previous release is not an ancestor of this commit; refusing to publish older or divergent history.');
    }
  }

  const tag = `update-${sha}`;
  if (git('tag', '--list', tag) && resolveCommit(`refs/tags/${tag}`) !== sha) {
    throw new Error(`Release tag ${tag} points to another commit.`);
  }

  const repositoryUrl = `https://github.com/${repository}`;
  const range = previousSha ? `${previousSha}..${sha}` : sha;
  const fields = git('log', '--reverse', '-z', '--format=%H%x00%s', range, '--').split('\0');
  const commits: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const subject = (fields[index + 1].replace(/\s+/g, ' ').trim() || '(no subject)')
      .replace(/[\\`*_{}\[\]()<>#!|@]/g, '\\$&');
    commits.push(`- ${subject} ([${fields[index].slice(0, 7)}](${repositoryUrl}/commit/${fields[index]}))`);
  }
  const comparisonUrl = previousSha
    ? `${repositoryUrl}/compare/${previousSha}...${sha}`
    : `${repositoryUrl}/commits/${sha}`;

  return {
    tag,
    title: `News Flow — ${date} (${sha.slice(0, 7)})`,
    notes: `## Changes\n\n${commits.join('\n')}\n\n[Full changes](${comparisonUrl})`,
    metadata: { id: sha, date, url: `${repositoryUrl}/releases/tag/${tag}` },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: '' },
      ref: { type: 'string', default: 'HEAD' },
      repository: { type: 'string', default: process.env.GITHUB_REPOSITORY || 'issogr/newsflow' },
      write: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Preview: node scripts/release-notes.mts --base <previous-release-tag> [--ref HEAD] [--repository owner/name]\nOmit --base for the first release. --write also writes frontend metadata and Actions outputs; requires GITHUB_OUTPUT and RUNNER_TEMP. No GitHub requests or publication are performed by this script.');
  } else {
    if (values.write && (!process.env.GITHUB_OUTPUT || !process.env.RUNNER_TEMP)) {
      throw new Error('--write requires GITHUB_OUTPUT and RUNNER_TEMP.');
    }
    const release = getReleaseNotes(values);
    if (values.write) {
      if (release) {
        const notesFile = join(process.env.RUNNER_TEMP!, 'newsflow-release-notes.md');
        writeFileSync('frontend/src/config/release.json', `${JSON.stringify(release.metadata, null, 2)}\n`);
        writeFileSync(notesFile, `${release.notes}\n`);
        appendFileSync(process.env.GITHUB_OUTPUT!, `publish=true\ntag=${release.tag}\ntitle=${release.title}\nnotes_file=${notesFile}\n`);
      } else {
        appendFileSync(process.env.GITHUB_OUTPUT!, 'publish=false\n');
      }
    }
    console.log(release ? `${release.title}\n\n${release.notes}` : 'This commit has already been released.');
  }
}
