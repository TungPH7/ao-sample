// The agent roster, agents/roster.yaml (agent-roster spec sections 2.1 to 2.3 and 6), and its rules A1 to A5 (spec
// section 7). Like lib/contract.mjs, only the read function touches the disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { NON_AGENT_ROLES } from '../rules/references.mjs';
import { schemaErrors } from '../rules/schema.mjs';

const schema = JSON.parse(readFileSync(new URL('../../agents/schema/roster.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

export function readRoster(dir = 'agents') {
  const file = join(dir, 'roster.yaml');
  try {
    return parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
}

// Adds the stack skills of a project's .ai-orchestrator/roster.local.yaml (spec 2.7). The file only adds skills: a
// role it names must exist, each skill must be in the project's .claude/skills/ (skillExists), and nothing else may be
// set. Returns { roster, errors }; the roster given is not changed.
export function mergeLocal(roster, local, { skillExists }) {
  if (!local) return { roster, errors: [] };
  const errors = [];
  const merged = structuredClone(roster);
  for (const key of Object.keys(local).filter((k) => k !== 'roles')) errors.push(`roster.local.yaml: ${key} cannot be set here; the file only has roles`);
  for (const [role, entry] of Object.entries(local.roles ?? {})) {
    if (!merged.roles[role]) {
      errors.push(`roster.local.yaml: '${role}' is not a role of agents/roster.yaml`);
      continue;
    }
    for (const key of Object.keys(entry ?? {}).filter((k) => k !== 'skills')) errors.push(`roster.local.yaml: roles.${role}.${key} cannot be set here; the file only adds skills`);
    for (const skill of entry?.skills ?? []) {
      if (!skillExists(skill)) errors.push(`roster.local.yaml: skill '${skill}' of ${role} is not in .claude/skills/`);
      else if (!merged.roles[role].skills.includes(skill)) merged.roles[role].skills.push(skill);
    }
  }
  return { roster: merged, errors };
}

// Returns every rule violation as { rule, path, message }; the contract must already be valid. gates, the project's
// quality/gates.yaml, says which roles use a GitHub App (A5). skills holds the SKILL.md text of each vendored skill
// in kit/.claude/skills/, by name, undefined when it is missing (A4). prompts lists the roles that have a file in
// agents/prompts/ (A2). Without one of them, that part is skipped.
export function validateRoster(roster, contract, { gates, skills, prompts } = {}) {
  if (!validateSchema(roster)) return schemaErrors(roster, validateSchema.errors, 'A1', 'agents/roster.yaml');
  return [
    ...checkMcpGroups(roster),
    ...checkRoles(roster, contract),
    ...(prompts ? checkPrompts(roster, prompts) : []),
    ...checkTransitions(roster, contract),
    ...checkSkills(roster),
    ...(skills ? checkVendored(roster, skills) : []),
    ...checkWriting(roster, gates),
  ];
}

// Rule A1, beyond the schema: a role's MCP tool groups are groups the roster offers for that server.
function checkMcpGroups(roster) {
  const errors = [];
  for (const [id, { mcp = {} }] of Object.entries(roster.roles)) {
    for (const [server, groups] of Object.entries(mcp)) {
      const offered = Object.keys(roster.mcp_tools[server] ?? {});
      const unknown = groups.filter((group) => !offered.includes(group));
      if (unknown.length > 0) {
        errors.push({ rule: 'A1', path: `roles.${id}.mcp.${server}`, message: `${unknown.join(', ')} not offered by mcp_tools.${server} (${offered.join(', ') || 'no groups'})` });
      }
    }
  }
  return errors;
}

// Rule A2: each agent role of the contract has exactly one roster entry, and every entry is an agent role.
function checkRoles(roster, contract) {
  const agentRoles = contract.roles.map(({ id }) => id).filter((id) => !NON_AGENT_ROLES.includes(id));
  const entries = Object.keys(roster.roles);
  return [
    ...agentRoles.filter((id) => !entries.includes(id)).map((id) => ({ rule: 'A2', path: `roles.${id}`, message: 'agent role of the contract has no roster entry' })),
    ...entries.filter((id) => !agentRoles.includes(id)).map((id) => ({ rule: 'A2', path: `roles.${id}`, message: 'is not an agent role of the contract' })),
  ];
}

// Rule A2, on disk: each roster entry has its hand-written prompt, and every prompt has an entry.
function checkPrompts(roster, prompts) {
  const entries = Object.keys(roster.roles);
  return [
    ...entries.filter((id) => !prompts.includes(id)).map((id) => ({ rule: 'A2', path: `roles.${id}`, message: `has no prompt in agents/prompts/${id}.md` })),
    ...prompts.filter((id) => !entries.includes(id)).map((id) => ({ rule: 'A2', path: `prompts.${id}`, message: `agents/prompts/${id}.md has no roster entry` })),
  ];
}

// Rule A3: only a role that is an actor of at least one transition may move items.
function checkTransitions(roster, contract) {
  const actors = new Set(Object.values(contract.workflows).flatMap(({ transitions }) => transitions.flatMap(({ actors: list }) => list)));
  return Object.entries(roster.roles)
    .filter(([id, { jira }]) => jira.includes('transition') && !actors.has(id))
    .map(([id]) => ({ rule: 'A3', path: `roles.${id}.jira`, message: `${id} is the actor of no transition, so it may not move items` }));
}

// The folders of kit/.claude/skills/ that are the kit's own commands, not vendored skills (dev-workflow spec 2.9).
export const KIT_SKILL_PREFIX = 'ao-';

// Rule A4: every preloaded skill is a vendored skill, and vendored names are unique. The vendored folders are checked
// when they exist (T9).
function checkSkills(roster) {
  const names = roster.vendored_skills.map(({ name }) => name);
  const errors = [];
  const twice = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (twice.length > 0) errors.push({ rule: 'A4', path: 'vendored_skills', message: `${twice.join(', ')} vendored twice` });
  // kit/.claude/skills/ao-* are the kit's own commands (dev-workflow T13): a vendored skill there would overwrite one.
  const kitNamed = names.filter((name) => name.startsWith(KIT_SKILL_PREFIX));
  if (kitNamed.length > 0) errors.push({ rule: 'A4', path: 'vendored_skills', message: `${kitNamed.join(', ')} uses the prefix ${KIT_SKILL_PREFIX} of the kit's commands` });
  for (const [id, { skills }] of Object.entries(roster.roles)) {
    const missing = skills.filter((skill) => !names.includes(skill));
    if (missing.length > 0) errors.push({ rule: 'A4', path: `roles.${id}.skills`, message: `${missing.join(', ')} not a vendored skill` });
  }
  return errors;
}

// Rule A4, on disk: each vendored skill has its folder in kit/.claude/skills/, with a SKILL.md named like the skill.
function checkVendored(roster, skills) {
  const errors = [];
  for (const { name } of roster.vendored_skills) {
    const text = skills.get(name);
    const declared = text?.match(/^---\r?\n(?:.*\r?\n)*?name:\s*(\S+)\s*$/m)?.[1];
    if (text === undefined) errors.push({ rule: 'A4', path: `vendored_skills.${name}`, message: `has no SKILL.md in kit/.claude/skills/${name}` });
    else if (declared !== name) errors.push({ rule: 'A4', path: `vendored_skills.${name}`, message: `SKILL.md is named ${declared ?? 'nothing'}, not ${name}` });
  }
  return errors;
}

// Rule A5: a role with a GitHub App or git write needs Bash; a role with Edit or Write lists the files it may write,
// and a role that lists files has Edit or Write.
function checkWriting(roster, gates) {
  const appRoles = new Set(Object.values(gates?.github_apps ?? {}).flatMap(({ roles }) => roles));
  const errors = [];
  for (const [id, { tools, git, writes }] of Object.entries(roster.roles)) {
    const needs = [appRoles.has(id) && 'a GitHub App', git === 'write' && 'git write'].filter(Boolean);
    if (needs.length > 0 && !tools.includes('Bash')) errors.push({ rule: 'A5', path: `roles.${id}.tools`, message: `${needs.join(' and ')} need Bash` });
    const writer = tools.includes('Edit') || tools.includes('Write');
    if (writer && writes.length === 0) errors.push({ rule: 'A5', path: `roles.${id}.writes`, message: 'the role has Edit or Write but no files it may write' });
    if (!writer && writes.length > 0) errors.push({ rule: 'A5', path: `roles.${id}.writes`, message: 'the role lists files to write but has neither Edit nor Write' });
  }
  return errors;
}
