// The options of git itself, which come before the subcommand (git --help), and the forms of git config that only
// read, for the two parts of gh-guard that read a git command: lib/quality/commands.mjs and lib/agents/scope.mjs. Pure.

// The options whose value may be the next word, as in `git --namespace x push`; with `=` it is in the same word.
const VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);

// words: a git command as words, starting with git. Returns the index of the subcommand (words.length when there is
// none), and the names of the settings the command sets with -c name=value or --config-env name=envvar, lowercased.
export function gitSubcommand(words) {
  const settings = [];
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const word = words[i];
    const equals = word.startsWith('--') ? word.indexOf('=') : -1;
    const option = equals > 0 ? word.slice(0, equals) : word;
    const value = equals > 0 ? word.slice(equals + 1) : VALUE_OPTIONS.has(word) ? words[i + 1] : undefined;
    if ((option === '-c' || option === '--config-env') && value !== undefined) settings.push(value.split('=')[0].toLowerCase());
    i += equals < 0 && VALUE_OPTIONS.has(word) ? 2 : 1;
  }
  return { index: i, settings };
}

// git config options that read, and options that only shape what is read or where from.
const CONFIG_GETS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '-l', '--list']);
const CONFIG_SHAPES = new Set(['--show-origin', '--show-scope', '--null', '-z', '--name-only', '--global', '--system', '--local', '--worktree', '--includes', '--no-includes', '--type', '--default', '--bool', '--int', '--path']);

// git config reads with --get and its kind, --list, `get` and `list`, or a single name; a name and a value write.
export function configReads(args) {
  const names = [];
  let gets = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const flag = arg.split('=')[0];
    if (CONFIG_GETS.has(flag)) gets = true;
    else if (CONFIG_SHAPES.has(flag)) {
      if ((flag === '--type' || flag === '--default') && !arg.includes('=')) i++;
    } else if (arg.startsWith('-')) return false;
    else names.push(arg);
  }
  if (['get', 'list'].includes(names[0])) return true;
  return names.length <= (gets ? 2 : 1);
}
