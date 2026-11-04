// The worktree of a PR under review holds the PR's code. Inside the project, Claude Code loaded the instruction files of
// a folder when the agent read a file in it: .claude/rules/ (review of ao-sample PR #13), CLAUDE.md, and AGENTS.md where
// the folder has no CLAUDE.md (its second review). Those of the PR would then steer the review of the PR. The worktree
// is now in the temp folder, outside the project, where a probe found none loaded (ao-step.mjs, reviewTreePath); ao-step
// still removes them right after it adds the worktree, in case a later Claude Code loads more. The agent reads them in
// the diff, or with git show. The names are those found in Claude Code 2.1.318.

// Names compared in lower case: Windows finds CLAUDE.md under the name claude.md.
const INSTRUCTION_FILES = ['claude.md', 'claude.local.md', 'agents.md'];
const INSTRUCTION_FOLDERS = ['.claude'];
// A worktree has no installed packages, so a node_modules in it is the PR's too; only git's own entry is skipped.
const SKIPPED = ['.git'];

// The instruction files and folders of a tree, as paths relative to it with forward slashes. The name decides before
// the type: a .claude that is a link to a folder is not a directory to readdir, and goes all the same. A link is not
// followed. fs: { readdirSync }.
export function instructionPaths(dir, { readdirSync }, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    const name = entry.name.toLowerCase();
    if (INSTRUCTION_FOLDERS.includes(name) || INSTRUCTION_FILES.includes(name)) found.push(path);
    else if (entry.isDirectory() && !SKIPPED.includes(name)) found.push(...instructionPaths(`${dir}/${entry.name}`, { readdirSync }, `${path}/`));
  }
  return found;
}

// Removes them; returns the paths removed. rmSync removes a link, not what it points to. fs: { readdirSync, rmSync }.
export function removeInstructions(dir, fs) {
  const paths = instructionPaths(dir, fs);
  for (const path of paths) fs.rmSync(`${dir}/${path}`, { recursive: true, force: true });
  return paths;
}
