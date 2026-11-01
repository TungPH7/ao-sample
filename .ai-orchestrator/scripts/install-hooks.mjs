// Points git at the kit hooks in .githooks (quality-gates spec section 2.3). The project's package.json runs it from its
// prepare script, so npm install sets it up. Running it again changes nothing.
// Usage: node .ai-orchestrator/scripts/install-hooks.mjs
import { spawnSync } from 'node:child_process';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

if (git('rev-parse', '--is-inside-work-tree').stdout.trim() !== 'true') {
  console.log('install-hooks: not a git repository, nothing to do');
} else if (git('config', '--get', 'core.hooksPath').stdout.trim() === '.githooks') {
  console.log('install-hooks: core.hooksPath is already .githooks');
} else {
  const result = git('config', 'core.hooksPath', '.githooks');
  if (result.status !== 0) {
    console.error(`install-hooks: git config failed: ${result.stderr.trim()}`);
    process.exit(1);
  }
  console.log('install-hooks: core.hooksPath set to .githooks');
}
