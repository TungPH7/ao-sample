// Coverage of the lines this branch adds or changes since it left <base> (quality-gates spec section 2.4), read from
// the lcov files that quality/gates.yaml names. Run it after the project's test:coverage script, in CI or before a push.
// Usage: node .ai-orchestrator/scripts/coverage-diff.mjs --base <ref>
import { spawnSync } from 'node:child_process';
import { appendFileSync, globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { changedLineCoverage, changedLines, parseLcov } from '../lib/quality/coverage.mjs';
import { readGates } from '../lib/quality/gates.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' } } });
if (!values.base) {
  console.error('Usage: node .ai-orchestrator/scripts/coverage-diff.mjs --base <ref>');
  process.exit(2);
}

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

try {
  const { coverage } = readGates(fileURLToPath(new URL('../quality/', import.meta.url)));
  const root = git('rev-parse', '--show-toplevel');
  const base = git('merge-base', values.base, 'HEAD');
  const changed = changedLines(git('diff', '-U0', '--no-color', '--no-ext-diff', base, 'HEAD'));

  // A package's lcov sits in <package>/coverage/, and its relative paths start at <package>.
  const lcov = new Map();
  for (const file of coverage.lcov.flatMap((glob) => globSync(glob, { cwd: root }))) {
    for (const [source, hits] of parseLcov(readFileSync(join(root, file), 'utf8'), { lcovDir: dirname(dirname(join(root, file))), root })) {
      lcov.set(source, hits);
    }
  }

  const result = changedLineCoverage({ changed, lcov, coverage });
  const rows = result.files.map(({ file, covered, total, uncovered }) => `${file}  ${covered} of ${total}${uncovered.length ? `  not run: ${uncovered.join(', ')}` : ''}`);
  console.log([...rows, `changed lines covered: ${result.percent}% (${result.covered} of ${result.total}); at least ${coverage.changed_lines_min}%`].join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = result.files.map(({ file, covered, total, uncovered }) => `| \`${file}\` | ${covered} of ${total} | ${uncovered.join(', ')} |`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Coverage of changed lines: ${result.percent}%\n\n| File | Covered | Lines not run |\n|---|---|---|\n${table.join('\n')}\n\n${result.problems.map((p) => `- ${p}`).join('\n')}\n`,
    );
  }
  if (!result.ok) {
    for (const problem of result.problems) console.error(`coverage-diff: ${problem}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`coverage-diff: ${error.message}`);
  process.exit(1);
}
