// What scripts/ao-git-credential.mjs answers git (dev-workflow spec 2.3). git runs the helper as
// `<helper> <role> <owner/name> <action>` and writes the request on stdin as key=value lines; with
// credential.useHttpPath the request names the repository. Pure: the script buys the token.

// The request as an object. A value may hold = signs.
export function parseCredentialRequest(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1);
  }
  return fields;
}

// For `get`: which App the token comes from and what it may do, or why there is none. A role with git write gets
// ao-dev with contents: write, plus workflows: write when quality/gates.yaml lets it edit the workflows (devops). A
// read-only role gets ao-review with contents: read: it fetches, and GitHub refuses its push. store and erase need
// nothing.
export function credentialPlan({ action, request, role, repo, roster, gates }) {
  if (action !== 'get') return {};
  if (request.protocol !== 'https' || request.host !== 'github.com') return { reason: `agents get a token only for https://github.com, not ${request.protocol}://${request.host}` };
  if (!request.path) return { reason: 'git did not name the repository: set credential.useHttpPath to true' };
  const asked = request.path.replace(/^\/+/, '').replace(/\.git$/, '');
  if (asked.toLowerCase() !== repo.toLowerCase()) return { reason: `agents get a token only on ${repo}, not ${asked}` };
  const git = roster.roles[role]?.git;
  if (git === 'read') return { kind: 'review', permissions: { contents: 'read' } };
  if (git !== 'write') return { reason: `${role} is not a role of agents/roster.yaml` };
  const workflows = gates.protected_paths.some(({ path, editors }) => path.startsWith('.github/workflows') && (editors ?? []).includes(role));
  return { kind: 'dev', permissions: { contents: 'write', ...(workflows && { workflows: 'write' }) } };
}

// git reads the token as the password of x-access-token. A token with a line break would add a field of its own.
export function credentialAnswer(token) {
  if (/[\r\n]/.test(token)) throw new Error('the token has a line break');
  return `username=x-access-token\npassword=${token}\n`;
}
