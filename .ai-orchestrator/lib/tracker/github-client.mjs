// Thin GitHub REST client for one repository (tracker-integration spec section 5). Read-only unless made with
// write: true, like the Jira client: any method but GET is refused before the request leaves. The token comes from
// GITHUB_TOKEN in CI, or from the GitHub CLI on your machine; readGitHubToken reads it.
import { spawnSync } from 'node:child_process';

const API = 'https://api.github.com';

export function createGitHubClient({ repo, token, fetch = globalThis.fetch, write = false }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-orchestrator',
  };

  async function send(method, url, label, body) {
    if (method !== 'GET' && !write) throw new Error(`Read-only GitHub client refused ${method} ${label}`);
    const res = await fetch(
      url,
      body === undefined ? { method, headers } : { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    if (!res.ok) {
      throw Object.assign(new Error(`GitHub ${method} ${label} returned ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
    }
    return res;
  }

  const urlOf = (path, query = {}) => {
    const url = new URL(`${API}/repos/${repo}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    return url;
  };

  // Writes such as a merge may answer 204 with no body.
  async function request(method, path, query, body) {
    const text = await (await send(method, urlOf(path, query), path, body)).text();
    return text ? JSON.parse(text) : null;
  }
  const get = (path, query) => request('GET', path, query);

  // Every item of a list, following the Link header. Most lists are arrays; a few, like check runs, keep their items
  // under a key.
  async function getAll(path, query = {}, itemsKey) {
    const items = [];
    let url = urlOf(path, { per_page: 100, ...query });
    while (url) {
      const res = await send('GET', url, path);
      const body = await res.json();
      items.push(...(itemsKey ? body[itemsKey] : body));
      url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return items;
  }

  return { request, get, getAll };
}

// GITHUB_TOKEN, else GH_TOKEN, the read-only token of an agent session (dev-workflow spec 2.3), else the token of the
// GitHub CLI: `gh auth token`, or on versions before 2.17, which lack it, the Token line of `gh auth status
// --show-token`, printed on stderr. Returns null when there is none. A token runs to the first space: the installation
// token of an App has dots in it (T18).
export function readGitHubToken({ env = process.env, gh = runGh } = {}) {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  if (env.GH_TOKEN) return env.GH_TOKEN;
  const token = gh(['auth', 'token']).stdout.trim();
  if (/^gh[opsu]_\S+$/.test(token)) return token;
  const { stdout, stderr } = gh(['auth', 'status', '--show-token']);
  return `${stdout}${stderr}`.match(/Token: (gh[opsu]_\S+)/)?.[1] ?? null;
}

// owner/name of the GitHub remote origin of the clone in `dir`; undefined when there is none.
export function originRepo(dir) {
  const url = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  return url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/)?.[1];
}

// stdout and stderr of a gh command whatever its exit code; both empty when gh is not installed.
function runGh(args) {
  const { stdout, stderr } = spawnSync('gh', args, { encoding: 'utf8' });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}
