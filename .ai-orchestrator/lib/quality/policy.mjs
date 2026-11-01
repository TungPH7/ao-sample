// The conventions and dependency steps of the policy job (quality-gates spec section 2.4). Pure: scripts/check-policy.mjs
// reads git, the PR event and npm audit.
import { checkBranch, checkPrTitle } from '../tracker/conventions.mjs';
import { checkCommitMessage } from './git-hooks.mjs';
import { LEVELS } from './suppressions.mjs';

// commits: [{ sha, parents, subject }] of the PR. Merge commits are left out: git writes them when a branch is updated.
export function checkConventions({ branch, base, commits, title }) {
  const problems = [];
  const branchCheck = checkBranch(branch, { base });
  if (!branchCheck.ok) problems.push(`branch ${branch}: ${branchCheck.reason}`);
  for (const { sha, parents, subject } of commits.filter((c) => c.parents < 2)) {
    const result = checkCommitMessage(subject);
    if (!result.ok) problems.push(`commit ${sha} "${subject}": ${result.reason}`);
  }
  const titleCheck = checkPrTitle(title);
  if (!titleCheck.ok) problems.push(`title "${title}": ${titleCheck.reason}`);
  return problems;
}

// The design.md files the policy job checks (agent-roster spec 2.8): each docs/specs/<EPIC-KEY>/design.md the PR adds or
// changes, and the one next to a design/ folder where the PR adds, changes or deletes an image, when it still exists.
// changes: [{ status, path }] from `git diff --name-status --no-renames`; exists tells whether a path is in the PR head.
export function designFilesToCheck(changes, exists) {
  const files = new Set();
  for (const { status, path } of changes) {
    if (/^docs\/specs\/[^/]+\/design\.md$/.test(path) && status !== 'D') files.add(path);
    const folder = path.match(/^(docs\/specs\/[^/]+)\/design\/.+$/)?.[1];
    if (folder && exists(`${folder}/design.md`)) files.add(`${folder}/design.md`);
  }
  return [...files];
}

// report: the JSON of `npm audit --json`. Each advisory counts once, however many packages pull it in; packages that
// are only vulnerable through another one list its name instead of an advisory.
export function auditProblems(report, { audit_level: level, exceptions }, today) {
  const advisories = new Map();
  for (const { via = [] } of Object.values(report.vulnerabilities ?? {})) {
    for (const item of via.filter((v) => typeof v === 'object')) advisories.set(item.url, item);
  }
  const problems = [];
  for (const { name, severity, title, url } of advisories.values()) {
    if (LEVELS.indexOf(severity) < LEVELS.indexOf(level)) continue;
    const id = url.split('/').at(-1);
    const exception = exceptions.find(({ advisory }) => advisory === id);
    if (exception && exception.expires >= today) continue;
    problems.push(`${name} ${severity}: ${title} (${id})${exception ? `; its exception expired on ${exception.expires}` : ''}`);
  }
  return problems;
}
