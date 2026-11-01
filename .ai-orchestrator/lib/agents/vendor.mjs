// Copies a skill from its GitHub repository at the commit pinned in agents/roster.yaml (agent-roster spec 2.7).
// planFiles, renameSkill and sourceNote are pure; vendorSkill fetches through the functions it is given and writes.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LICENSE = /^(LICEN[SC]E|COPYING)(\.(md|txt))?$/i;

// The files to copy: every blob under the skill folder, then the license at the root of the repository. The root
// license is saved as LICENSE, or as REPO-LICENSE when the folder has a LICENSE of its own.
// tree: the response of GET /repos/{repo}/git/trees/{commit}?recursive=1.
export function planFiles(skill, tree) {
  if (tree.truncated) throw new Error(`the tree of ${skill.repo} at ${skill.commit} is truncated`);
  const prefix = `${skill.path}/`;
  const blobs = tree.tree.filter(({ type, path }) => type === 'blob' && path.startsWith(prefix));
  const files = blobs.map(({ path }) => ({ from: path, to: path.slice(prefix.length) }));
  if (!files.some(({ to }) => to === 'SKILL.md')) throw new Error(`no SKILL.md under ${skill.path} in ${skill.repo} at ${skill.commit}`);
  const root = tree.tree.find(({ type, path }) => type === 'blob' && LICENSE.test(path));
  if (root) files.push({ from: root.path, to: files.some(({ to }) => LICENSE.test(to)) ? 'REPO-LICENSE' : 'LICENSE' });
  return files;
}

// Sets the name: line of a SKILL.md frontmatter.
export function renameSkill(text, name) {
  const match = text.match(/^---\r?\n[\s\S]*?^name:.*$/m);
  if (!match || match.index !== 0 || /\n---\s*\n/.test(match[0])) throw new Error('the SKILL.md has no frontmatter name');
  return text.slice(0, match.index) + match[0].replace(/^name:.*$/m, `name: ${name}`) + text.slice(match.index + match[0].length);
}

export function sourceNote(skill, { date, files }) {
  const change = skill.upstream_name ? `\`name:\` renamed from \`${skill.upstream_name}\` to \`${skill.name}\`` : 'None';
  return [
    `# Source of ${skill.name}`,
    '',
    `Copied by \`npm run skills:vendor -- ${skill.name}\` (agent-roster spec 2.7). Do not edit these files: change the commit`,
    'in agents/roster.yaml and run the command again, so the update is a PR with a diff to read.',
    '',
    '| | |',
    '|---|---|',
    `| Repository | https://github.com/${skill.repo} |`,
    `| Path | \`${skill.path}\` |`,
    `| Commit | \`${skill.commit}\` (${date}) |`,
    `| Changes | ${change} |`,
    '',
    '## Files',
    '',
    ...files.map((file) => `- \`${file}\`${file === 'REPO-LICENSE' || (file === 'LICENSE' && !files.includes('REPO-LICENSE')) ? ': the license at the root of the repository' : ''}`),
    '',
  ].join('\n');
}

// Writes the skill into dir, replacing what was there. Returns the files written, SOURCE.md last.
export async function vendorSkill(skill, { dir, fetchJson, fetchBytes }) {
  const api = `https://api.github.com/repos/${skill.repo}`;
  const tree = await fetchJson(`${api}/git/trees/${skill.commit}?recursive=1`);
  const { commit } = await fetchJson(`${api}/commits/${skill.commit}`);
  const files = planFiles(skill, tree);
  const contents = [];
  for (const { from, to } of files) {
    const bytes = await fetchBytes(`https://raw.githubusercontent.com/${skill.repo}/${skill.commit}/${from}`);
    contents.push([to, to === 'SKILL.md' && skill.upstream_name ? Buffer.from(renameSkill(bytes.toString('utf8'), skill.name)) : bytes]);
  }
  rmSync(dir, { recursive: true, force: true });
  for (const [to, bytes] of contents) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    writeFileSync(join(dir, to), bytes);
  }
  const names = files.map(({ to }) => to);
  writeFileSync(join(dir, 'SOURCE.md'), sourceNote(skill, { date: commit.committer.date.slice(0, 10), files: names }));
  return [...names, 'SOURCE.md'];
}
