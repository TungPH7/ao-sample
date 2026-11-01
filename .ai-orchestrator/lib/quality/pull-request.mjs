// Checks of the PR artifacts (quality-gates spec sections 2.2 and 2.5): the title and description of a PR against
// templates/pull-request.md, and a review report (its head and its findings) against templates/review-report.md. Pure.
// A project's kit copy has no templates folder, so the sections, placeholders and severities are listed here; tests
// keep them equal to the templates.
import { checkPrTitle } from '../tracker/conventions.mjs';

export const PR_SECTIONS = ['Jira', 'What Changed', 'How It Was Tested', 'Acceptance Criteria Coverage', 'Risks', 'Definition of Done'];
export const PLACEHOLDERS = ['<type(scope): subject>', '<KEY>', '<Given … When … Then …>', '<test file › test name>'];

// The level-2 sections of a Markdown text, without guidance comments: { name: content }.
function sections(markdown) {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '');
  const found = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      current = heading[1];
      found[current] = '';
    } else if (current) found[current] += `${line}\n`;
  }
  return { text, found };
}

export function checkPullRequest({ title, body }) {
  const problems = [...checkTitle(title), ...checkDescription(body)];
  return { ok: problems.length === 0, problems };
}

export function checkTitle(title) {
  const result = checkPrTitle(title ?? '');
  return result.ok ? [] : [`title: ${result.reason}`];
}

export function checkDescription(body) {
  const problems = [];
  const { text, found } = sections(body ?? '');
  for (const name of PR_SECTIONS) {
    if (!(name in found)) problems.push(`${name}: the section is missing`);
    else if (found[name].trim() === '') problems.push(`${name}: the section is empty`);
  }
  for (const placeholder of PLACEHOLDERS.filter((p) => text.includes(p))) problems.push(`placeholder: ${placeholder} is still in the description`);
  if ('Example' in found) problems.push('Example: delete the Example section of the template');
  return problems;
}

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
// Findings that block the merge (templates/review-report.md).
const BLOCKING = ['Critical', 'High'];
const FINDING_COLUMNS = ['severity', 'axis', 'where', 'finding', 'fix'];

// A review report as merge-gate reads it: the role of its Role line, the rows of its Findings table, and those that
// block the merge. Text that is not a report has no role; a report merge-gate cannot read lists problems.
export function readReviewReport(body, roles) {
  const header = checkReviewHeader(body, roles);
  if (!header.ok) return { ok: false, problems: header.problems };
  const { found } = sections(body);
  if (!('Findings' in found)) return { ok: false, role: header.role, problems: ['the report needs a "## Findings" section'] };
  const findings = [];
  const problems = [];
  const rows = found.Findings.split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    // The header and separator rows.
    .filter((cells) => cells[0].toLowerCase() !== 'severity' && !cells.every((cell) => /^:?-+:?$/.test(cell)));
  rows.forEach((cells, index) => {
    const severity = SEVERITIES.find((s) => s.toLowerCase() === cells[0].replace(/[*_`]/g, '').trim().toLowerCase());
    if (severity) findings.push(Object.fromEntries(FINDING_COLUMNS.map((column, i) => [column, i === 0 ? severity : cells[i]])));
    else problems.push(`finding ${index + 1}: severity '${cells[0]}' is not Critical, High, Medium or Low`);
  });
  // A security review of the new part only says from which commit (dev-workflow spec 2.6).
  const since = body.match(/^Scope:\s*changes since\s+([0-9a-f]{7,40})\s*$/m)?.[1];
  return { ok: problems.length === 0, role: header.role, findings, blocking: findings.filter(({ severity }) => BLOCKING.includes(severity)), problems, ...(since && { scope: { since } }) };
}

// The first heading and the Role line that tell merge-gate which role wrote a review report.
export function checkReviewHeader(body, roles) {
  const problems = [];
  const lines = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!/^# Review: .+\(\S+\)\s*$/.test(lines[0] ?? '')) problems.push('the report must start with "# Review: <PR title> (<KEY>)"');
  const role = lines.find((line) => /^Role:/.test(line))?.replace(/^Role:\s*/, '').trim();
  if (!roles.includes(role)) problems.push(`the report needs a line ${roles.map((r) => `"Role: ${r}"`).join(' or ')}`);
  return { ok: problems.length === 0, role: problems.length === 0 ? role : undefined, problems };
}
