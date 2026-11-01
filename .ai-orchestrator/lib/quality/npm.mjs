// Runs npm without a shell. On Windows npm is npm.cmd, which Node only starts through a shell, and a shell is what
// Semgrep's spawn-shell-true rule and Node's DEP0190 warning are about (found in T13). npm ships as npm-cli.js next to
// node: in node_modules/ on Windows, in ../lib/node_modules/ on Linux and macOS. Elsewhere, plain `npm` is tried.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function npmCli(execPath = process.execPath) {
  const dir = dirname(execPath);
  const candidates = [join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  return candidates.find((file) => existsSync(file));
}

export function runNpm(args, options = {}) {
  const cli = npmCli();
  return cli ? spawnSync(process.execPath, [cli, ...args], options) : spawnSync('npm', args, options);
}
