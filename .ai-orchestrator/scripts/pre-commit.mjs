// The pre-commit hook (quality-gates spec section 2.3): secretlint on the staged text of every added or changed file,
// then the project's own precommit npm script, where project-scaffold puts the lint of staged files for its stack.
// Usage, from kit/.githooks/pre-commit: node .ai-orchestrator/scripts/pre-commit.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine } from '@secretlint/node';
import { runNpm } from '../lib/quality/npm.mjs';
import { scanStaged } from '../lib/quality/pre-commit.mjs';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const root = git('rev-parse', '--show-toplevel').stdout.trim();
const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').stdout.split('\0').filter(Boolean);

const engine = await createEngine({
  cwd: root,
  formatter: 'stylish',
  color: false,
  maskSecrets: true,
  configFileJSON: { rules: [{ id: '@secretlint/secretlint-rule-preset-recommend' }] },
});
const scan = await scanStaged({ files, read: (file) => git('show', `:${file}`).stdout, lint: engine.executeOnContent });
if (!scan.ok) {
  console.error(scan.output);
  console.error('pre-commit: a staged file holds a secret. Remove it, keep it in an environment variable, and stage again.');
  process.exit(1);
}

const packageFile = join(root, 'package.json');
const scripts = existsSync(packageFile) ? (JSON.parse(readFileSync(packageFile, 'utf8')).scripts ?? {}) : {};
if (scripts.precommit) {
  const run = runNpm(['run', 'precommit'], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`pre-commit: the project's precommit script failed (exit ${run.status})`);
    process.exit(1);
  }
}
