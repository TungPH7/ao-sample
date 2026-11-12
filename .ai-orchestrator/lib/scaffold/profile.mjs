// A profile of the kit (project-scaffold spec 2.6): the skeleton of a stack in profiles/<name>/files/, and its
// profile.yaml, which says the apps, the stack skills, the version of Node and what runs once the files are copied.
// ao-kit init copies a profile into an empty folder; npm run profiles:check builds one in a temporary folder.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse, stringify } from 'yaml';

// Reads profiles/<name>/profile.yaml of the kit. `after` comes back as argv lists, run with no shell.
export function readProfile(kitDir, name) {
  const dir = join(kitDir, 'profiles', name);
  if (!existsSync(join(dir, 'profile.yaml'))) {
    const have = existsSync(join(kitDir, 'profiles')) ? readdirSync(join(kitDir, 'profiles')).join(', ') : 'none';
    throw new Error(`no profile ${name} in profiles/; the kit has ${have}`);
  }
  const data = parse(readFileSync(join(dir, 'profile.yaml'), 'utf8'));
  return { ...data, after: (data.after ?? []).map((command) => command.trim().split(/\s+/)), filesDir: join(dir, 'files') };
}

// A text file has no NUL byte; an image or an icon has.
const isText = (buffer) => !buffer.includes(0);

// Copies the skeleton of the profile into projectDir, with __NAME__ (the project, lower case) and __TITLE__ (its name
// for people) replaced in every text file. Returns the paths written, relative, with forward slashes.
export function copyProfile({ profile, projectDir, name, title }) {
  const written = [];
  for (const entry of readdirSync(profile.filesDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())) {
    const from = join(entry.parentPath ?? entry.path, entry.name);
    const path = relative(profile.filesDir, from).replaceAll('\\', '/');
    const buffer = readFileSync(from);
    mkdirSync(join(projectDir, path, '..'), { recursive: true });
    writeFileSync(join(projectDir, path), isText(buffer) ? buffer.toString('utf8').replaceAll('__NAME__', name).replaceAll('__TITLE__', title) : buffer);
    written.push(path);
  }
  return written.sort();
}

// The project.yaml of a new project made from the profile. project: { name, space, repo, approvers, apps: { dev,
// dev_id, review, review_id }, kitPeers }.
export function projectYaml(profile, project) {
  const repoName = project.repo.split('/')[1];
  const config = {
    name: project.name,
    jira: { space: project.space },
    github: { repo: project.repo, approvers: project.approvers, apps: project.apps, kit_peers: project.kitPeers ?? [] },
    repos: [{ name: repoName, path: '.' }],
    apps: Object.fromEntries(Object.entries(profile.apps).map(([app, value]) => [app, { repo: repoName, ...value }])),
    roles: { optional: [] },
    claude: { allow: [] },
  };
  return `# The config of this project (SPEC-project-scaffold.md 2.1), written by ao-kit init from the profile ${profile.name}.\n${stringify(config)}`;
}

// roster.local.yaml of a new project: the stack skills of the profile.
export function rosterLocalYaml(profile) {
  const roles = Object.fromEntries(Object.entries(profile.skills ?? {}).map(([role, skills]) => [role, { skills }]));
  return `# Stack skills of this project (agent-roster spec 2.7), from the profile ${profile.name}. Each skill sits in .claude/skills/.\n${stringify({ roles })}`;
}
