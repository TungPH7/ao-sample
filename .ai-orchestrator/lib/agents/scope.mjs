// The two role rules gh-guard adds from agents/roster.yaml (agent-roster spec 2.10): a role writes only the files of
// its `writes` globs, and a role with read-only git runs only git commands that read. Pure; each function returns the
// reason of a refusal, or null.
import { configReads, gitSubcommand } from '../quality/git-options.mjs';
import { matchesGlob } from '../quality/glob.mjs';

// path: inside the project, with forward slashes. Roles the roster does not know are not checked here.
export function writeRefusal(roster, role, path) {
  const writes = roster.roles[role]?.writes;
  // Windows paths ignore letter case, so the globs do too.
  if (!writes || writes.some((glob) => matchesGlob(glob.toLowerCase(), path.toLowerCase()))) return null;
  return `${role} may write only ${writes.join(', ') || 'no file'} (agents/roster.yaml), not ${path}`;
}

// The git subcommands that only read (spec 2.10). branch, remote and config read only in some forms, below.
const READ = new Set(['status', 'log', 'show', 'diff', 'fetch', 'ls-remote', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'merge-base', 'blame', 'grep', 'describe', 'shortlog', 'for-each-ref', 'check-ignore']);
// git branch options that list; the ones that take a commit may be followed by one.
const BRANCH_LISTING = new Set(['-a', '--all', '-r', '--remotes', '-l', '--list', '-v', '-vv', '--verbose', '--show-current', '--no-color', '--color', '--column', '--no-column', '-i', '--ignore-case', '--omit-empty']);
const BRANCH_COMMIT = new Set(['--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);

// words: a git command as words, starting with git. Options of git itself (-C <path>, -c name=value, --no-pager…)
// come before the subcommand.
export function gitRefusal(roster, role, words) {
  if (roster.roles[role]?.git !== 'read') return null;
  const [sub, ...args] = words.slice(gitSubcommand(words).index);
  if (sub === undefined || (READ.has(sub) && !writesAnyway(sub, args))) return null;
  if (sub === 'branch' && branchLists(args)) return null;
  if (sub === 'remote' && (args.length === 0 || args.every((a) => a === '-v' || a === '--verbose') || ['show', 'get-url'].includes(args.find((a) => !a.startsWith('-'))))) return null;
  if (sub === 'config' && configReads(args)) return null;
  return `${role} has read-only git (agents/roster.yaml): git ${sub} would change the shared checkout or the repository. Read another branch with git show <ref>:<path> or git diff <ref>`;
}

// A read command in a form that writes: --output (or its start, which git takes) writes a file, and a fetch refspec
// with : moves a local branch.
function writesAnyway(sub, args) {
  if (args.some((arg) => /^--outp(?:u|ut)?(?:=|$)/.test(arg))) return true;
  return sub === 'fetch' && args.filter((arg) => !arg.startsWith('-')).slice(1).some((arg) => arg.includes(':'));
}

function branchLists(args) {
  const listing = args.includes('-l') || args.includes('--list');
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flag = arg.split('=')[0];
    if (BRANCH_COMMIT.has(flag)) {
      if (!arg.includes('=') && args[i + 1] && !args[i + 1].startsWith('-')) i++;
    } else if (BRANCH_LISTING.has(arg) || /^--(format|sort)=/.test(arg)) continue;
    else if (arg.startsWith('-') || !listing) return false;
  }
  return true;
}
