// One tick of the deployer for one project (release-workflow spec 2.3, 2.4, 2.9; plan decisions 3 to 5). For
// Development, then Staging, then Production: your newest deployment request if there is one, else each new head of a
// branch the environment runs; auditRange audits it, decideTarget decides, the installer builds, smoke-tests and swaps,
// and a deployment status on GitHub says how it went. Each environment saves the record before the next one starts, and
// a deploy under way is kept in the record, so a tick cut short is finished by the next one with the same deployment.
// Every outside effect is a parameter: git in the mirror, the GitHub client, the audit, the installer, the record store.
import { chmod, lstat, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { formatError } from '../contract.mjs';
import { parseBranch } from '../tracker/conventions.mjs';
import { readDeployConfig } from './deploy-config.mjs';
import { PRUNE_CACHE, buildArgs, containerEnv, parseSecrets, pruneImages, readableMode, swap, treesToKeep } from './docker.mjs';
import { hasBaseline, markRequest, recordRun, runsByEnvironment } from './record.mjs';
import { smoke as runSmoke } from './smoke.mjs';
import { ENVIRONMENTS, decideTarget } from './targets.mjs';

const FULL_SHA = /^[0-9a-f]{40}$/;
const DESCRIPTION = 140; // GitHub keeps this much of a deployment status description
const REQUESTS = 30; // newest deployments read per environment

// The environment git gets for a fetch: the installation token as an HTTP header, the way actions/checkout passes it,
// so it is in no argument, no remote URL and no file.
export function gitAuthEnv(token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

const refs = (out) =>
  Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.trim().split(' '))
      .filter(([, sha]) => FULL_SHA.test(sha ?? '')),
  );

// The heads of develop and main, and of the release branches not merged into main yet.
export async function readHeads(git) {
  const all = refs(await git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/']));
  if (!all.develop || !all.main) throw new Error('the mirror has no develop or no main branch');
  const open = refs(await git(['for-each-ref', '--no-merged', all.main, '--format=%(refname:short) %(objectname)', 'refs/heads/release/']));
  return { develop: all.develop, main: all.main, releases: Object.fromEntries(Object.entries(open).filter(([name]) => parseBranch(name)?.kind === 'release')) };
}

async function treeOf(git, sha) {
  if (!FULL_SHA.test(sha ?? '')) throw new Error(`${JSON.stringify(sha)} is not a full commit hash`);
  const tree = (await git(['rev-parse', '--verify', `${sha}^{tree}`])).trim();
  if (!FULL_SHA.test(tree)) throw new Error(`no tree for ${sha.slice(0, 7)}`);
  return tree;
}

// project: { name, repo, urls: { development, staging, production } }. state: the record, saved with `save`. git runs
// in the project's mirror; token is the installation token of ao-deploy, used only for the fetch. github: a writing
// client of the repo. audit({ since, head, branch }) is auditRange with its facts bound. installer: { install, prune }.
export async function tick(options) {
  const { project, state, git, token, log } = options;
  if (!hasBaseline(state)) {
    log(`no baseline: run ao-deploy.mjs baseline ${project.name} --confirm`);
    return;
  }
  await git(['fetch', '--prune', '--quiet', 'origin'], { env: gitAuthEnv(token) });
  const ctx = { ...options, heads: await readHeads(git), now: options.now ?? (() => new Date().toISOString()) };
  for (const env of ENVIRONMENTS) await tickEnvironment(ctx, env);
}

async function tickEnvironment(ctx, env) {
  const { state, git, approvers, dryRun, log } = ctx;
  const record = state.environments[env];
  if (record.pending) {
    if (dryRun) return log(`${env}: would finish the deploy of ${record.pending.sha.slice(0, 7)} cut short`);
    return deploy(ctx, env, record.pending);
  }

  const request = await newestRequest(ctx, env);
  if (request) {
    let tree;
    try {
      tree = await treeOf(git, request.sha);
    } catch {
      return act(ctx, env, { action: 'refuse', reason: `${String(request.sha).slice(0, 7)} is not a commit of the repository` }, { request: request.id, sha: request.sha });
    }
    const facts = { sha: request.sha, tree, creator: request.creator?.login, rollback: request.payload.rollback === true };
    return act(ctx, env, decideTarget({ environment: env, request: facts, record: runsByEnvironment(state), approvers }), { request: request.id, sha: request.sha });
  }

  for (const { branch, sha } of candidates(ctx, env)) {
    if (record.seen[branch] === sha) continue;
    const tree = await treeOf(git, sha);
    const audits = await auditsOf(ctx, branch, sha);
    const candidate = { sha, tree, branch, audits, pull: audits.at(-1)?.pull ?? null };
    const decision = decideTarget({ environment: env, candidate, record: runsByEnvironment(state), approvers });
    if (decision.action !== 'skip') return act(ctx, env, decision, { branch, sha });
    log(`${env}: skip ${sha.slice(0, 7)} on ${branch}: ${decision.reason}`);
    if (!dryRun) {
      record.seen[branch] = sha;
      await ctx.save(state);
    }
  }
}

// The heads an environment runs (spec 2.4, 2.8). On Staging a hotfix comes first, and holds Staging until it is on
// Production; then the open release branch, when there is exactly one.
function candidates({ heads, state, log }, env) {
  if (env === 'development') return [{ branch: 'develop', sha: heads.develop }];
  if (env === 'production') return [{ branch: 'main', sha: heads.main }];
  const list = [{ branch: 'main', sha: heads.main }];
  const { current } = state.environments.staging;
  const held = current?.branch === 'main' && !state.environments.production.runs.some(({ ok, tree }) => ok && tree === current.tree);
  const open = Object.entries(heads.releases);
  if (open.length > 1) log(`staging: ${open.map(([name]) => name).join(' and ')} are all open; Staging runs none of them`);
  if (!held && open.length === 1) list.push({ branch: open[0][0], sha: open[0][1] });
  return list;
}

// The audits of every commit of `branch` since the newest one audited, up to `head`. A new release branch starts from
// develop's, since it was cut from develop. The record keeps how far the audit got.
async function auditsOf({ state, audit }, branch, head) {
  const known = state.branches[branch];
  const since = known?.audited ?? (parseBranch(branch)?.kind === 'release' ? state.branches.develop?.audited : undefined);
  if (!since) return [{ sha: head, ok: false, problems: [`there is no audited commit of ${branch} to start from`], pull: null }];
  if (since === head) return [{ sha: head, ok: true, problems: [], pull: known?.pull ?? null }];
  const { audits } = await audit({ since, head, branch });
  const passed = audits.filter(({ ok }) => ok).at(-1);
  if (passed) state.branches[branch] = { audited: passed.sha, pull: passed.pull ?? null };
  return audits;
}

// Your newest deployment request for `env` not handled yet; older ones are answered as superseded.
async function newestRequest({ github, state, dryRun }, env) {
  const list = await github.get('/deployments', { environment: env, per_page: REQUESTS });
  const open = list.filter(({ id, payload }) => payload?.ao === 'request' && !state.requests.includes(id));
  if (!dryRun) {
    for (const old of open.slice(1)) {
      await status(github, old.id, 'error', { description: `superseded by deployment ${open[0].id}` });
      markRequest(state, old.id);
    }
  }
  return open[0] ?? null;
}

async function act(ctx, env, decision, { branch = null, sha, request = null }) {
  const { state, github, dryRun, log, save } = ctx;
  const record = state.environments[env];
  const short = (decision.sha ?? sha).slice(0, 7);
  const from = request ? `request ${request}` : branch;
  if (dryRun) return log(`${env}: would ${decision.action} ${short} from ${from}${decision.reason ? `: ${decision.reason}` : ''}`);

  if (decision.action === 'refuse') {
    const id = request ?? (await createDeployment(github, env, sha, 'branch'));
    await status(github, id, 'error', { description: decision.reason });
    if (request) markRequest(state, request);
    else record.seen[branch] = sha;
    await save(state);
    return log(`${env}: refused ${short} from ${from}: ${decision.reason}`);
  }

  const id = request ?? (await createDeployment(github, env, decision.sha, decision.via));
  if (request) markRequest(state, request);
  if (decision.via === 'request') await approveHistory(ctx, env, decision.sha);
  record.pending = { branch, sha: decision.sha, deployment: id, via: decision.via };
  await save(state);
  return deploy(ctx, env, record.pending, decision.tree);
}

// Your deployment request for a commit, not a rollback, says you read the history up to it (plan decision 5): each
// branch of the environment that holds it is audited from there on, unless its audit already got further.
async function approveHistory({ state, git, heads, log }, env, sha) {
  const own = { development: ['develop'], staging: ['main', ...Object.keys(heads.releases)], production: ['main'] }[env];
  const holding = (await git(['for-each-ref', '--contains', sha, '--format=%(refname:short)', 'refs/heads/'])).split('\n').map((line) => line.trim());
  for (const branch of own.filter((name) => holding.includes(name))) {
    const audited = state.branches[branch]?.audited;
    if (audited && audited !== sha) {
      try {
        await git(['merge-base', '--is-ancestor', audited, sha]);
      } catch {
        continue; // the audit is already past this commit
      }
    }
    state.branches[branch] = { audited: sha, pull: null };
    if (heads[branch] === sha || heads.releases[branch] === sha) state.environments[env].seen[branch] = sha;
    log(`${env}: you approved the history of ${branch} up to ${sha.slice(0, 7)}`);
  }
}

async function deploy(ctx, env, pending, known) {
  const { state, git, github, installer, project, save, log, now } = ctx;
  const record = state.environments[env];
  const { branch, sha, deployment: id, via } = pending;
  const tree = known ?? (await treeOf(git, sha));
  await status(github, id, 'in_progress');
  const before = record.current;
  // A commit that changes only what the image leaves out, like the docs, keeps the containers that run.
  const result = before?.tree === tree ? { outcome: 'success', public: before.public } : await installer.install({ env, sha, tree });
  const ok = result.outcome === 'success';
  recordRun(state, env, { sha, tree, ok, via, branch, at: now(), public: result.public });
  if (branch) record.seen[branch] = sha;
  record.pending = null;
  await status(github, id, result.outcome, ok ? { environment_url: project.urls[env] } : { description: result.reason });
  await save(state);
  log(`${env}: ${ok ? 'deployed' : result.outcome === 'failure' ? 'failed' : 'could not deploy'} ${sha.slice(0, 7)}${ok ? '' : `: ${result.reason}`}`);
  if (ok && before?.tree !== tree) {
    try {
      await installer.prune(treesToKeep(runsByEnvironment(state)));
    } catch (error) {
      log(`${env}: pruning images failed: ${error.message}`);
    }
  }
}

async function createDeployment(github, env, sha, via) {
  const { id } = await github.request('POST', '/deployments', undefined, {
    ref: sha,
    environment: env,
    auto_merge: false,
    required_contexts: [],
    description: `ao-deploy: ${via}`,
    payload: { ao: 'deploy', via },
    production_environment: env === 'production',
    transient_environment: false,
  });
  return id;
}

async function status(github, id, state, extra = {}) {
  const body = { state, auto_inactive: true, ...extra };
  if (body.description) body.description = body.description.length > DESCRIPTION ? `${body.description.slice(0, DESCRIPTION - 1)}…` : body.description;
  await github.request('POST', `/deployments/${id}/statuses`, undefined, body);
}

// Gives every file and folder under `dir` the mode a build context needs (readableMode). Links are left alone: chmod
// would follow them out of the worktree.
export async function openForBuild(dir) {
  await chmod(dir, readableMode((await lstat(dir)).mode & 0o777, true));
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = posix.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await openForBuild(path);
    else await chmod(path, readableMode((await lstat(path)).mode & 0o777, false));
  }
}

// Builds and runs a project at a tree with T7's docker.mjs, from a worktree of the mirror. Resolves to { outcome,
// reason, public }: 'success', with the public app and its port for Caddy; 'failure' when the new containers did not start or failed their smoke test, so the old ones
// still serve; 'error' when nothing ran: no or a broken deploy.yaml, a missing secret, a failed build. An error of
// Docker itself throws, and the next tick tries again.
export function createInstaller({ project, git, docker, smoke = (checks, targets) => runSmoke({ checks, targets }), workDir, readSecrets, open = openForBuild }) {
  const failed = (reason) => ({ outcome: 'error', reason });
  return {
    async install({ env, sha, tree }) {
      let text;
      try {
        text = await git(['show', `${sha}:.ai-orchestrator/deploy.yaml`]);
      } catch {
        return failed(`${sha.slice(0, 7)} has no .ai-orchestrator/deploy.yaml`);
      }
      const { config, errors } = readDeployConfig(text);
      if (errors.length > 0) return failed(`deploy.yaml: ${errors.map(formatError).join('; ')}`);
      let secrets;
      try {
        secrets = parseSecrets(await readSecrets(env));
      } catch (error) {
        return failed(`the secrets of ${env}: ${error.message}`);
      }
      // Found before a build that would be thrown away; swap checks the same again.
      const missing = Object.entries(config.apps).flatMap(([app, spec]) => containerEnv({ app: spec, secrets, publicUrl: project.urls[env] }).missing.map((name) => `${name} (${app})`));
      if (missing.length > 0) return failed(`missing in /etc/ao/secrets/${project.name}/${env}.env: ${missing.join(', ')}`);

      const dir = posix.join(workDir, tree);
      await git(['worktree', 'remove', '--force', dir]).catch(() => {});
      await git(['worktree', 'prune']);
      await git(['worktree', 'add', '--detach', '--force', dir, sha]);
      try {
        try {
          await open(dir);
        } catch (error) {
          return failed(`the build folder could not be opened: ${error.message}`);
        }
        for (const [app, { dockerfile }] of Object.entries(config.apps)) {
          try {
            await docker(buildArgs({ project: project.name, app, tree, dockerfile, context: dir }));
          } catch (error) {
            return failed(`the build of ${app} failed: ${error.message.slice(-300)}`);
          }
        }
      } finally {
        await git(['worktree', 'remove', '--force', dir]).catch(() => {});
      }

      const result = await swap({ run: docker, smoke, project: project.name, env, tree, config, secrets, publicUrl: project.urls[env] });
      if (result.outcome === 'switched') {
        const [app, { port }] = Object.entries(config.apps).find(([, spec]) => spec.public);
        return { outcome: 'success', public: { app, port } };
      }
      if (result.outcome === 'refused') return failed(result.reason);
      return { outcome: 'failure', reason: result.failures.map(({ app, path, problem }) => `${app}${path ? ` ${path}` : ''}: ${problem}`).join('; ') };
    },
    async prune(keep) {
      await pruneImages({ run: docker, project: project.name, keep });
      await docker(PRUNE_CACHE);
    },
  };
}
