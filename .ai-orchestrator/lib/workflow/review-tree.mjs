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

// Whether a path of a PR is, or is inside, an instruction file or folder, at any depth: /ao-preview does not run such a
// PR from the project folder, where Claude Code would load them (review of ao-sample PR #21).
export function isInstructionPath(path) {
  const parts = path.replaceAll('\\', '/').split('/').map((part) => part.toLowerCase());
  return parts.some((part) => INSTRUCTION_FOLDERS.includes(part)) || INSTRUCTION_FILES.includes(parts.at(-1));
}

// What else steers a session once a branch is checked out in the project folder, as /ao-preview does: plugins and MCP
// servers Claude Code reads there, and the git files that change how a checkout is written, at any depth (Medium of
// security on ao-sample PR #21; live-run-fixes spec 2.7). The worktree of a review is outside the project, and keeps
// them.
const STEERING_FILES = ['.mcp.json', '.gitmodules', '.gitattributes', '.lfsconfig'];
const STEERING_FOLDERS = ['.claude-plugin'];

// Whether a path of a PR steers a session in the project folder: an instruction path, or one of those.
export function isSteeringPath(path) {
  const parts = path.replaceAll('\\', '/').split('/').map((part) => part.toLowerCase());
  return isInstructionPath(path) || parts.some((part) => STEERING_FOLDERS.includes(part)) || STEERING_FILES.includes(parts.at(-1));
}

// Removes them; returns the paths removed. rmSync removes a link, not what it points to. fs: { readdirSync, rmSync }.
export function removeInstructions(dir, fs) {
  const paths = instructionPaths(dir, fs);
  for (const path of paths) fs.rmSync(`${dir}/${path}`, { recursive: true, force: true });
  return paths;
}
