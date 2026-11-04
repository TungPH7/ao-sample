// The worktree of a PR under review holds the PR's code, and it sits inside the project, where the review session runs.
// Claude Code loads the instruction files of a folder when the agent reads a file in it: .claude/rules/ (seen in the
// review of ao-sample PR #13) and CLAUDE.md. Those of the PR would then steer the review of the PR. ao-step removes
// them from the worktree right after it is added; the agent reads them in the diff, or with git show.

// Names compared in lower case: Windows finds CLAUDE.md under the name claude.md.
const INSTRUCTION_FILES = ['claude.md', 'claude.local.md'];
const INSTRUCTION_FOLDERS = ['.claude'];
// A worktree has no installed packages, so a node_modules in it is the PR's too; only git's own entry is skipped.
const SKIPPED = ['.git'];

// The instruction files and folders of a tree, as paths relative to it with forward slashes. fs: { readdirSync }.
export function instructionPaths(dir, { readdirSync }, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    const name = entry.name.toLowerCase();
    if (entry.isDirectory()) {
      if (INSTRUCTION_FOLDERS.includes(name)) found.push(path);
      else if (!SKIPPED.includes(name)) found.push(...instructionPaths(`${dir}/${entry.name}`, { readdirSync }, `${path}/`));
    } else if (INSTRUCTION_FILES.includes(name)) found.push(path);
  }
  return found;
}

// Removes them; returns the paths removed. fs: { readdirSync, rmSync }.
export function removeInstructions(dir, fs) {
  const paths = instructionPaths(dir, fs);
  for (const path of paths) fs.rmSync(`${dir}/${path}`, { recursive: true, force: true });
  return paths;
}
