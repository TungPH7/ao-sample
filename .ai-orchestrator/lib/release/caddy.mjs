// The Caddyfile of the VPS (release-workflow spec 2.3, 2.11): one site per host of /etc/ao/deployer.yaml, proxied to the
// public app of the release that runs in that environment, by the alias docker.mjs gives it. Development and Staging
// ask for the shared basic auth account; Production is open. An environment with no release yet answers 503, and still
// has its site, so Caddy holds its certificate before the first deploy. The deployer writes the file after each tick
// and reloads Caddy only when the text changed. Every name in it was checked by deployer-config.mjs or docker.mjs.
import { ENVIRONMENTS } from './targets.mjs';

const CREDENTIALS = /^([a-z][a-z0-9_-]*) (\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53})$/;
const RELOAD = ['exec', 'caddy', 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'];

// The sites of every project and environment, from the configuration and each project's record ({ [name]: state }).
export function caddySites(config, states) {
  return config.projects.flatMap((project) =>
    ENVIRONMENTS.map((env) => {
      const running = states[project.name]?.environments[env].current?.public;
      const upstream = running ? `ao-${project.name}-${env}-${running.app}:${Number(running.port)}` : null;
      return { host: project.hosts[env], upstream, auth: env !== 'production' };
    }),
  );
}

// credentials: the line "<user> <bcrypt hash>" of the basic auth file.
export function caddyfile({ sites, credentials }) {
  const match = CREDENTIALS.exec(credentials.trim());
  if (!match) throw new Error('the basic auth file must hold one line: a user name, a space, and a bcrypt hash from caddy hash-password');
  const lines = [
    '# Written by the ai-orchestrator deployer from /etc/ao/deployer.yaml and the release running in each environment.',
    '# Any edit here is overwritten at the next deploy.',
    ':80 {',
    '\trespond 404',
    '}',
    '',
  ];
  for (const { host, upstream, auth } of sites) {
    lines.push(`${host} {`);
    if (auth) lines.push('\tbasic_auth {', `\t\t${match[1]} ${match[2]}`, '\t}');
    lines.push(upstream ? `\treverse_proxy ${upstream}` : '\trespond "Not deployed yet" 503', '}', '');
  }
  return lines.join('\n');
}

// Writes the Caddyfile and reloads Caddy when its text changed. The file is written in place, since the Caddy
// container mounts that one file; Caddy checks a new file before it switches, and keeps the old one if it is wrong.
// Returns whether the text changed.
export async function updateCaddy({ config, states, credentials, read, write, docker, dryRun = false, log }) {
  const text = caddyfile({ sites: caddySites(config, states), credentials });
  const before = await read().catch(() => '');
  if (before === text) return false;
  if (dryRun) {
    log(`would write ${config.caddyfile ?? 'the Caddyfile'} and reload Caddy`);
    return true;
  }
  await write(text);
  await docker(RELOAD);
  log('Caddyfile written; Caddy reloaded');
  return true;
}
