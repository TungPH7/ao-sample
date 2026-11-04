// Jira key conventions for branches, commits and PR titles (tracker-integration spec section 2.5). Pure functions:
// `quality-gates` wires them into the commit-msg hook and CI, and `facts.mjs` uses them to find an item's work.

const KEY = '[A-Z][A-Z0-9]+-\\d+';
const KEYS = new RegExp(KEY, 'g');
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 40;
const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];

// The branch prefix each work type uses, and the base branches each prefix is cut from.
const PREFIXES_BY_TYPE = { story: ['feature'], task: ['feature'], bug: ['bugfix', 'hotfix'] };
const BASES = {
  feature: { test: (base) => base === 'develop', text: 'develop' },
  bugfix: { test: (base) => base === 'develop' || base.startsWith('release/'), text: 'develop or release/*' },
  hotfix: { test: (base) => base === 'main', text: 'main' },
};

// The kinds of work item branch, the prefixes before the Jira key.
export const WORK_BRANCH_KINDS = Object.keys(BASES);

export function extractKeys(text) {
  return [...new Set(text.match(KEYS) ?? [])];
}

// Returns { kind, key, slug, round } for a work item branch, { kind: 'release', version } for a release branch,
// or null when the name follows neither convention. round is 1 for the first branch, N for the -rN suffix.
export function parseBranch(name) {
  const release = name.match(/^release\/v(\d+\.\d+\.\d+)$/);
  if (release) return { kind: 'release', version: release[1] };
  const work = name.match(new RegExp(`^(feature|bugfix|hotfix)/(${KEY})-(.+?)(?:-r(\\d+))?$`));
  if (!work) return null;
  const [, kind, key, slug, round] = work;
  if (!SLUG.test(slug) || slug.length > SLUG_MAX || round === '0' || round === '1') return null;
  return { kind, key, slug, round: round ? Number(round) : 1 };
}

// Checks a branch name; with workType and base, also that the prefix fits the item and the branch it is cut from.
export function checkBranch(name, { workType, base } = {}) {
  const reason = branchNameProblem(name);
  if (reason) return { ok: false, reason };
  const { kind } = parseBranch(name);
  if (kind === 'release') return { ok: true };
  const prefixes = PREFIXES_BY_TYPE[workType];
  if (prefixes && !prefixes.includes(kind)) {
    return { ok: false, reason: `a ${workType} branch starts with ${prefixes.map((p) => `${p}/`).join(' or ')}` };
  }
  if (base && !BASES[kind].test(base)) return { ok: false, reason: `a ${kind}/ branch is cut from ${BASES[kind].text}, not ${base}` };
  return { ok: true };
}

function branchNameProblem(name) {
  if (name.startsWith('release/')) {
    return parseBranch(name) ? null : 'a release branch is release/v<major>.<minor>.<patch>';
  }
  const prefixed = name.match(/^(feature|bugfix|hotfix)\/(.*)$/);
  if (!prefixed) return 'a branch starts with feature/, bugfix/, hotfix/ or release/';
  const [, kind, rest] = prefixed;
  const keyed = rest.match(new RegExp(`^${KEY}-(.+?)(?:-r(\\d+))?$`));
  if (!keyed) return `the branch needs the Jira key: ${kind}/<KEY>-<slug>`;
  const [, slug, round] = keyed;
  if (round === '0' || round === '1') return 'only a branch made after qa-fail has a suffix, starting at -r2';
  if (!SLUG.test(slug)) return `the slug '${slug}' may only have lower-case letters, digits and single hyphens`;
  if (slug.length > SLUG_MAX) return `the slug is ${slug.length} characters, at most ${SLUG_MAX}`;
  return null;
}

// Checks the header (first line) of a commit message: type(scope): subject (<KEY>[, <SUB-TASK KEY>…]).
export function checkCommit(message, { requireKey = true } = {}) {
  const header = message.split(/\r?\n/, 1)[0];
  const parts = header.match(/^([a-z]+)\(([a-z0-9-]+)\): (.*)$/);
  if (!parts) return { ok: false, reason: 'the header must be type(scope): subject (<KEY>)' };
  const [, type, , rest] = parts;
  if (!TYPES.includes(type)) return { ok: false, reason: `unknown type '${type}', use one of: ${TYPES.join(', ')}` };

  const keyed = rest.match(new RegExp(`^(.*?)\\s*\\((${KEY}(?:, ${KEY})*)\\)$`));
  if (!keyed && requireKey) return { ok: false, reason: 'end the header with the Jira key in parentheses: (<KEY>) or (<KEY>, <SUB-TASK KEY>)' };
  const subject = keyed ? keyed[1] : rest;
  if (subject.trim() === '') return { ok: false, reason: 'the subject is empty' };
  return { ok: true, keys: keyed ? keyed[2].split(', ') : [] };
}

// A PR title is the commit header format with exactly one key, the key of the item (template pull-request.md).
export function checkPrTitle(title) {
  // checkCommit reads only the first line; a title holds one (Pilot 1, review of ao-sample PR #7).
  if (/[\r\n]/.test(title)) return { ok: false, reason: 'a PR title is one line, with no line break' };
  const result = checkCommit(title);
  if (result.ok && result.keys.length !== 1) return { ok: false, reason: 'a PR title has one Jira key, the key of the item' };
  return result;
}
