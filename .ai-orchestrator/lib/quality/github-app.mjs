// Tokens of the agents' GitHub Apps (quality-gates spec section 2.2). A JWT signed with the App's private key proves
// the App; with it the App buys an installation token for one repository, valid for an hour. No error message ever
// carries the key, the JWT or a token.
import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { APPS } from './app-manifest.mjs';

const API = 'https://api.github.com';

// Issued a minute early for clock drift; GitHub refuses a JWT that lives longer than 10 minutes.
export function appJwt({ appId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 60;
  const encode = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat, exp: iat + 540, iss: appId })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}

// `permissions` narrows the token below what the App has, e.g. { pull_requests: 'write' }.
export async function installationToken({ appId, privateKey, repo, permissions, fetch = globalThis.fetch, now }) {
  const headers = {
    Authorization: `Bearer ${appJwt({ appId, privateKey, now })}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-orchestrator',
  };
  async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    const hint = {
      401: `GitHub refused the JWT of App ${appId}: check the App ID and the private key`,
      404: `App ${appId} is not installed on ${repo}`,
      // dev-workflow T2: GitHub answers 422 when the token asks for more than the installation was granted.
      422: `App ${appId} on ${repo} lacks a permission of ${JSON.stringify(permissions)}: add it to the App, then accept it on the installation (docs/github-apps-setup.md)`,
    }[res.status];
    throw new Error(hint ?? `GitHub App ${appId}: ${method} ${path} returned ${res.status}`);
  }

  const { id } = await call('GET', `/repos/${repo}/installation`);
  const name = repo.split('/')[1];
  const { token, expires_at: expiresAt } = await call('POST', `/app/installations/${id}/access_tokens`, {
    repositories: [name],
    ...(permissions && { permissions }),
  });
  return { token, expiresAt };
}

// The account that commits for an App (dev-workflow spec 2.3): <slug>[bot], with the noreply address GitHub links to
// it, which needs the bot's user id.
export async function botIdentity({ slug, token, fetch = globalThis.fetch }) {
  const login = `${slug}[bot]`;
  const res = await fetch(`${API}/users/${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-orchestrator' },
  });
  if (!res.ok) throw new Error(`GitHub has no user ${login}: check AO_DEV_APP (${res.status})`);
  const { id } = await res.json();
  return { name: login, email: `${id}+${login}@users.noreply.github.com` };
}

// owner/name of a GitHub remote URL, by HTTPS or SSH. The name is safe to put in a command line.
export function githubRepoOf(url) {
  const repo = url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  if (!repo) throw new Error(`the origin remote is not a GitHub repository: ${url || 'none'}`);
  return repo;
}

// The App of one kind, 'dev' or 'review': id and slug from AO_<KIND>_APP_ID and AO_<KIND>_APP (set in the project's
// .claude/settings.json), and the private key from AO_<KIND>_APP_KEY (the key itself, in CI) or from the file that
// AO_<KIND>_APP_KEY_FILE names (your machine). A variable missing from the environment is looked up among your user
// variables, since Claude Code keeps the environment it started with.
export function appCredentials(kind, { env = process.env, readFile = readFileSync, readUserVariable = userVariable } = {}) {
  if (!APPS[kind]) throw new Error(`unknown App kind '${kind}', use one of: ${Object.keys(APPS).join(', ')}`);
  const prefix = `AO_${kind.toUpperCase()}_APP`;
  const read = (name) => env[name] || readUserVariable(name);
  const appId = read(`${prefix}_ID`);
  const slug = read(prefix);
  if (!appId) throw new Error(`${prefix}_ID is not set`);
  if (!slug) throw new Error(`${prefix} is not set`);
  // The key itself only ever comes from the environment of a CI job; your machine names a file.
  const key = env[`${prefix}_KEY`];
  const file = key ? undefined : read(`${prefix}_KEY_FILE`);
  if (!key && !file) throw new Error(`${prefix}_KEY or ${prefix}_KEY_FILE is not set`);
  return { appId: Number(appId), slug, privateKey: key ?? readFile(file, 'utf8') };
}

// A user environment variable as Windows stores it (HKCU\Environment); undefined elsewhere or when it is not set.
export function userVariable(name) {
  if (process.platform !== 'win32') return undefined;
  const { stdout } = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8' });
  return stdout?.match(new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*?)\\s*$`, 'm'))?.[1];
}
