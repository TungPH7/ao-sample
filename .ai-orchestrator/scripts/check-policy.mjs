// The policy job of CI (quality-gates spec section 2.4). On a PR: the conventions of its branch, commits and title, the
// suppressions its added lines bring, the thresholds it lowers in quality/gates.yaml, the design.md files it touches
// (agent-roster spec 2.8), and npm audit. On a push: npm audit only. Results go to the job summary in CI.
// In CI the PR comes from the GitHub event; elsewhere: --base <ref> --branch <name> --title "<title>".
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { unquotePath } from '../lib/quality/diff-paths.mjs';
import { readGates } from '../lib/quality/gates.mjs';
import { runNpm } from '../lib/quality/npm.mjs';
import { checkDesignFile } from '../lib/quality/design-files.mjs';
import { auditProblems, checkConventions, designFilesToCheck } from '../lib/quality/policy.mjs';
import { addedLines, deletedTests, findSuppressions, loweredThresholds } from '../lib/quality/suppressions.mjs';

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}
function git(...args) {
  const result = run('git', args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

// The PR under check, or null on a push.
function pullRequest() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, branch: { type: 'string' }, title: { type: 'string' } } });
  if (values.base) return { base: values.base, baseRef: values.base.replace(/^origin\//, ''), branch: values.branch ?? git('rev-parse', '--abbrev-ref', 'HEAD'), title: values.title ?? '' };
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  return { base: pr.base.sha, baseRef: pr.base.ref, branch: pr.head.ref, title: pr.title };
}

const gatesDir = fileURLToPath(new URL('../quality/', import.meta.url));
const sections = [];
const notes = [];
try {
  const gates = readGates(gatesDir);
  const root = git('rev-parse', '--show-toplevel');
  const pr = pullRequest();

  if (pr) {
    const base = git('merge-base', pr.base, 'HEAD');
    const commits = git('log', '--format=%h%x09%P%x09%s', `${base}..HEAD`)
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, parents, ...subject] = line.split('\t');
        return { sha, parents: parents.split(' ').length, subject: subject.join('\t') };
      });
    sections.push(['Conventions', checkConventions({ branch: pr.branch, base: pr.baseRef, commits, title: pr.title })]);

    const diff = git('diff', '-U0', '--no-color', '--no-ext-diff', base, 'HEAD');
    sections.push(['Suppressions', findSuppressions(addedLines(diff), gates.suppressions)]);
    for (const file of deletedTests(diff)) notes.push(`test file deleted: ${file}`);

    const gatesFile = relative(root, join(gatesDir, 'gates.yaml')).replaceAll('\\', '/');
    const before = run('git', ['show', `${base}:${gatesFile}`]);
    sections.push(['Thresholds', before.status === 0 ? loweredThresholds(parse(before.stdout), gates) : []]);

    const changes = git('diff', '--name-status', '--no-renames', base, 'HEAD')
      .split('\n')
      .filter(Boolean)
      .map((line) => ({ status: line[0], path: unquotePath(line.split('\t').at(-1)) }));
    const designs = designFilesToCheck(changes, (path) => existsSync(join(root, path)));
    sections.push(['Design', designs.flatMap((path) => checkDesignFile(join(root, path)).map(({ rule, line, message }) => `${path}:${line} ${rule} ${message}`))]);
  }

  if (existsSync(join(root, 'package-lock.json'))) {
    // npm audit exits non-zero when it finds anything; its JSON is what counts.
    const audit = runNpm(['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const report = JSON.parse(audit.stdout || '{}');
    if (report.error) throw new Error(`npm audit: ${report.error.summary ?? report.error.code}`);
    sections.push(['Dependencies', auditProblems(report, gates.dependencies, new Date().toISOString().slice(0, 10))]);
  } else notes.push('no package-lock.json: npm audit skipped');
} catch (error) {
  sections.push(['Policy', [error.message]]);
}

const failed = sections.filter(([, problems]) => problems.length > 0);
for (const [name, problems] of sections) console.log(`${problems.length === 0 ? 'ok' : 'FAIL'}  ${name}${problems.map((p) => `\n      ${p}`).join('')}`);
for (const note of notes) console.log(`note  ${note}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = sections.map(([name, problems]) => `- ${problems.length === 0 ? '✅' : '❌'} **${name}**${problems.map((p) => `\n  - ${p}`).join('')}`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Policy\n\n${[...lines, ...notes.map((n) => `- ℹ️ ${n}`)].join('\n')}\n`);
}
if (failed.length > 0) process.exit(1);
