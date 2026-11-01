// The settings of a project that are not secret (AO_JIRA_SPACE, AO_APPROVERS, the slugs and ids of the GitHub Apps)
// live in the env block of its .claude/settings.json, where Claude Code hands them to the hooks. The scripts that run
// in CI read them here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The env block of the project's .claude/settings.json, or nothing.
export function projectSettings(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).env ?? {};
  } catch {
    return {};
  }
}

// An environment variable, else the project setting. A placeholder left from the kit, like <KEY>, counts as unset.
export function setting(name, settings, env = process.env) {
  const value = env[name] || settings[name];
  return value && !/^<.*>$/.test(value) ? value : undefined;
}
