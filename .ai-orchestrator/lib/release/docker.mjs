// The Docker side of the deployer (release-workflow spec 2.3, 2.9; plan decisions 2 and 4). Every docker command is an
// array of arguments for execFile, never a shell line, and only full trees, plain names and fixed flags reach it: no
// branch name, no secret value. `run(args, { env })` runs docker and resolves to its output; the deployer starts it with
// a bare environment plus `env`, so a container gets exactly the variables its app names in deploy.yaml.
import { posix } from 'node:path';
import { ENVIRONMENTS } from './targets.mjs';

const NAME = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;
const TREE = /^[0-9a-f]{40}$/;
const VARIABLE = /^[A-Z_][A-Z0-9_]*$/;
const KEEP = 3; // images kept per environment, for rollback without a build
const CADDY = 'caddy';

// Trims the build cache to the 4 GB used most recently, after each deploy: npm ci still hits the cache, and the disk
// does not fill up (T2 of the plan: six builds left 7.25 GB).
export const PRUNE_CACHE = ['buildx', 'prune', '--force', '--max-used-space', '4gb'];

function allowed(kind, value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${kind} ${JSON.stringify(value)} is not allowed in a docker argument`);
  return value;
}
function environment(env) {
  if (!ENVIRONMENTS.includes(env)) throw new Error(`environment ${JSON.stringify(env)} is not allowed in a docker argument`);
  return env;
}

const network = (project, env) => `ao-${allowed('project', project, NAME)}-${environment(env)}`;
const image = (project, app, tree) => `ao-${allowed('project', project, NAME)}-${allowed('app', app, NAME)}:${allowed('tree', tree, TREE)}`;
const container = (project, env, app, tree) => `${network(project, env)}-${allowed('app', app, NAME)}-${allowed('tree', tree, TREE).slice(0, 12)}`;
// Two names on the project network: the app's own, which the other apps of the project call, and one unique on the
// VPS, which Caddy calls, since Caddy joins the network of every project and environment.
const aliases = (project, env, app) => [app, `${network(project, env)}-${app}`];

// Builds the image of one app at a tree, from the root of a checkout of that tree.
export function buildArgs({ project, app, tree, dockerfile, context }) {
  if (typeof context !== 'string' || !context.startsWith('/')) throw new Error(`build context ${JSON.stringify(context)} is not an absolute path`);
  if (typeof dockerfile !== 'string' || dockerfile.startsWith('/') || dockerfile.split('/').includes('..')) throw new Error(`dockerfile ${JSON.stringify(dockerfile)} is not inside the checkout`);
  const labels = [`ao.project=${project}`, `ao.app=${app}`, `ao.tree=${tree}`].flatMap((label) => ['--label', label]);
  return ['build', '--file', posix.join(context, dockerfile), '--tag', image(project, app, tree), ...labels, context];
}

// The mode a file of a build context needs. COPY keeps the modes of the context, and the deployer runs with UMask=0077,
// so a checkout is 0600 and 0700: an image with a USER other than root could not read its own code (release-workflow
// T19). The context lives under /var/lib/ao, which is 0700, so opening it shows nothing to anyone else on the VPS.
export const readableMode = (mode, isDirectory) => mode | 0o044 | (isDirectory || mode & 0o100 ? 0o011 : 0);

// Runs a new container of one app on the project network, without an alias yet, so nothing calls it before its smoke
// test. `names` are the variables it gets from docker's own environment: names only, never values.
export function runArgs({ project, env, app, tree, names }) {
  const labels = [`ao.project=${project}`, `ao.env=${env}`, `ao.app=${app}`, `ao.tree=${tree}`].flatMap((label) => ['--label', label]);
  return [
    'run', '--detach', '--name', container(project, env, app, tree), '--network', network(project, env),
    '--restart', 'unless-stopped', '--pull', 'never', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
    ...labels,
    ...names.flatMap((name) => ['--env', allowed('variable', name, VARIABLE)]),
    image(project, app, tree),
  ];
}

// The variables of one app: the names it lists in deploy.yaml, with their values from the secrets file of the
// environment, and AO_PUBLIC_URL for the public app (spec 2.3). `missing` lists names the secrets file lacks.
export function containerEnv({ app, secrets, publicUrl }) {
  const declared = app.env ?? [];
  const values = Object.fromEntries(declared.filter((name) => Object.hasOwn(secrets, name)).map((name) => [name, secrets[name]]));
  if (app.public) values.AO_PUBLIC_URL = publicUrl;
  return { names: app.public ? [...declared, 'AO_PUBLIC_URL'] : declared, values, missing: declared.filter((name) => !Object.hasOwn(secrets, name)) };
}

// Reads /etc/ao/secrets/<project>/<env>.env: NAME=value lines, blank lines and # comments. An error names the line by
// its number only, so a value never reaches a log.
export function parseSecrets(text) {
  const secrets = {};
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const at = line.indexOf('=');
    if (at < 1 || !VARIABLE.test(line.slice(0, at))) throw new Error(`line ${i + 1} of the secrets file is not NAME=value`);
    secrets[line.slice(0, at)] = line.slice(at + 1);
  });
  return secrets;
}

// Deploys `tree` with no downtime (plan decision 4). App by app, those that are not public first, so the public app is
// smoke-tested against the new ones: run the new container next to the old, smoke-test it on its own address, then
// move the aliases to it, keeping the old container running without them. When every app passed, the old containers
// stop. When one fails, the apps already moved get their old containers back, and every new container goes.
// `smoke(checks, targets)` resolves to { ok, failures }. Returns { outcome: 'switched' | 'failed' | 'refused',
// failures, stopped, reason }.
export async function swap({ run, smoke, project, env, tree, config, secrets, publicUrl }) {
  const net = network(project, env);
  const order = Object.keys(config.apps).sort((a, b) => Number(Boolean(config.apps[a].public)) - Number(Boolean(config.apps[b].public)));
  const envs = Object.fromEntries(order.map((app) => [app, containerEnv({ app: config.apps[app], secrets, publicUrl })]));
  const missing = order.flatMap((app) => envs[app].missing.map((name) => `${name} (${app})`));
  if (missing.length > 0) return { outcome: 'refused', failures: [], stopped: [], reason: `missing in /etc/ao/secrets/${project}/${env}.env: ${missing.join(', ')}` };

  await ensureNetwork(run, project, env);
  const existing = await listContainers(run, project, env);
  const fresh = new Set(order.map((app) => container(project, env, app, tree)));
  // A container of this tree left by a deploy cut short is removed, so the new one can take its name.
  for (const { name } of existing.filter(({ name }) => fresh.has(name))) await run(['rm', '--force', name]);
  const old = existing.filter(({ name }) => !fresh.has(name));

  const moved = [];
  for (const app of order) {
    const name = container(project, env, app, tree);
    const { port, health } = config.apps[app];
    try {
      await run(runArgs({ project, env, app, tree, names: envs[app].names }), { env: envs[app].values });
    } catch (error) {
      await undo(run, net, project, env, [{ app, name }, ...moved.toReversed()], old);
      return { outcome: 'failed', failures: [{ app, path: null, problem: `the container did not start: ${error.message}` }], stopped: [] };
    }
    const ip = JSON.parse(await run(['inspect', '--format', '{{json .NetworkSettings.Networks}}', name]))[net].IPAddress;
    if (!ip) {
      // It exited, and --restart may be bringing it back: there is nothing to smoke-test yet.
      const state = (await run(['inspect', '--format', '{{.State.Status}}, exit code {{.State.ExitCode}}', name])).trim();
      await undo(run, net, project, env, [{ app, name }, ...moved.toReversed()], old);
      return { outcome: 'failed', failures: [{ app, path: null, problem: `the container has no address: it is ${state}` }], stopped: [] };
    }
    const host = config.apps[app].public ? new URL(publicUrl).host : `${app}:${port}`;
    const checks = config.smoke.filter((check) => check.app === app);
    if (!checks.some(({ path }) => path === health)) checks.unshift({ app, path: health, expect_status: 200, expect_text: '' });
    const result = await smoke(checks, { [app]: { origin: `http://${ip}:${port}`, host } });
    if (!result.ok) {
      await undo(run, net, project, env, [{ app, name }, ...moved.toReversed()], old);
      return { outcome: 'failed', failures: result.failures, stopped: [] };
    }
    await connect(run, net, name, aliases(project, env, app));
    for (const previous of old.filter((c) => c.app === app && c.state === 'running')) await connect(run, net, previous.name, []);
    moved.push({ app, name });
  }

  for (const { name } of old) {
    await run(['stop', name]);
    await run(['rm', name]);
  }
  return { outcome: 'switched', failures: [], stopped: old.map(({ name }) => name) };
}

// Undoes a deploy: `steps` lists the new container of the app that failed, then those of the apps already moved, newest
// first. Each old container gets its aliases back before the new one goes, so the app is never without one.
async function undo(run, net, project, env, steps, old) {
  for (const [i, { app, name }] of steps.entries()) {
    if (i > 0) for (const previous of old.filter((c) => c.app === app && c.state === 'running')) await connect(run, net, previous.name, aliases(project, env, app));
    try {
      await run(['rm', '--force', name]);
    } catch {
      // docker run failed before the container existed: there is nothing to remove.
    }
  }
}

// Docker sets the aliases of a container only when it joins a network, so it leaves and joins again.
async function connect(run, net, name, names) {
  await run(['network', 'disconnect', net, name]);
  await run(['network', 'connect', ...names.flatMap((alias) => ['--alias', alias]), net, name]);
}

async function ensureNetwork(run, project, env) {
  const net = network(project, env);
  let members;
  try {
    members = JSON.parse((await run(['network', 'inspect', '--format', '{{json .Containers}}', net])) || 'null');
  } catch {
    await run(['network', 'create', '--driver', 'bridge', '--label', `ao.project=${project}`, '--label', `ao.env=${env}`, net]);
    members = null;
  }
  if (!Object.values(members ?? {}).some(({ Name }) => Name === CADDY)) await run(['network', 'connect', net, CADDY]);
}

async function listContainers(run, project, env) {
  const out = await run(['ps', '--all', '--filter', `label=ao.project=${project}`, '--filter', `label=ao.env=${env}`, '--format', '{{.Names}}\t{{.State}}\t{{.Label "ao.app"}}\t{{.Label "ao.tree"}}']);
  return out.split('\n').filter(Boolean).map((line) => {
    const [name, state, app, tree] = line.split('\t');
    return { name, state, app, tree };
  });
}

// The trees whose images stay: the newest KEEP that ran with a green smoke test on each environment, by the deployer's
// record ({ [env]: [{ tree, ok }] }, oldest first).
export function treesToKeep(record, count = KEEP) {
  const keep = new Set();
  for (const runs of Object.values(record)) {
    const trees = [];
    for (const { tree, ok } of runs.toReversed()) {
      if (ok && !trees.includes(tree)) trees.push(tree);
      if (trees.length === count) break;
    }
    trees.forEach((tree) => keep.add(tree));
  }
  return keep;
}

// Removes the images of a project whose tree is not kept. Docker refuses to remove an image a container still uses;
// such an image stays. Returns the images removed.
export async function pruneImages({ run, project, keep }) {
  const out = await run(['image', 'ls', '--filter', `label=ao.project=${allowed('project', project, NAME)}`, '--format', '{{.Repository}}:{{.Tag}}']);
  const removed = [];
  for (const tag of out.split('\n').filter(Boolean)) {
    if (keep.has(tag.slice(tag.lastIndexOf(':') + 1))) continue;
    try {
      await run(['image', 'rm', tag]);
      removed.push(tag);
    } catch {
      // In use by a container: it stays until the next prune.
    }
  }
  return removed;
}
