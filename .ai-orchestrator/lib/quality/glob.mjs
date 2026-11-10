// The globs of quality/gates.yaml: `**` matches across folders, `*` within one name, `{a,b}` either text.
// Paths use forward slashes.
export function globToRegExp(glob, flags = '') {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      // `**/` also matches no folder at all, so `**/*.ts` matches `a.ts`.
      pattern += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '{') pattern += '(?:';
    else if (char === '}') pattern += ')';
    else if (char === ',' && glob.lastIndexOf('{', i) > glob.lastIndexOf('}', i)) pattern += '|';
    else pattern += char.replace(/[.+?^$()|[\]\\]/, '\\$&');
  }
  return new RegExp(`^${pattern}$`, flags);
}

export const matchesGlob = (glob, path, { ignoreCase = false } = {}) => globToRegExp(glob, ignoreCase ? 'i' : '').test(path);
