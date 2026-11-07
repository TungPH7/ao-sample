// What ao-step does around a qa run (release-workflow spec 2.5), besides the run itself: the basic auth of Development
// and Staging for Playwright, and, once the run ends and before its worktree goes, the evidence attached to the item with
// the CI token, and a check that the environment still runs the release qa tested. The effects are parameters.

// AO_ENV_AUTH, a user variable of your Windows account, is "user:password". An error never quotes it.
export function basicAuthEnv(envAuth) {
  const at = typeof envAuth === 'string' ? envAuth.indexOf(':') : -1;
  if (at < 1 || at === envAuth.length - 1) throw new Error('AO_ENV_AUTH must be user:password, the basic auth of Development and Staging (docs/vps-setup.md section 11)');
  return { E2E_HTTP_USER: envAuth.slice(0, at), E2E_HTTP_PASSWORD: envAuth.slice(at + 1) };
}

const short = (sha) => (sha ? sha.slice(0, 8) : 'nothing');
const title = (env) => `${env[0].toUpperCase()}${env.slice(1)}`;
const TRACE = /(^|\/)trace\.zip$/;
const MEDIA = /\.(png|jpe?g|gif|webp|webm|mp4)$/i;

// run: the qa run ({ key, qa: { environment, sha, auth } }); tree: its worktree ({ path }). list(dir) gives the files
// under a folder, [] when there is none; attach(key, files) resolves { attached, skipped } (lib/tracker/attachments.mjs);
// keep(key, files) copies files out of the worktree and resolves the folder; running(environment) resolves the sha that
// runs there now. Resolves notes for state.json and last.md.
// Behind basic auth (qa.auth) the traces are kept, not attached: Playwright writes the context options, httpCredentials
// with the password in clear, into every trace (seen at T19 of release-workflow), and Jira would show it to its readers.
// Of .ai/qa/<KEY>/ only images and videos go then: qa may have pointed outputDir there, as it did on DEMO-12.
export async function qaFollowUp({ run, tree, projectDir, list, attach, keep, running }) {
  const notes = [];
  const dir = (path) => path.replaceAll('\\', '/').replace(/\/+$/, '');
  const traces = tree ? list(`${dir(tree.path)}/test-results`).filter((file) => TRACE.test(file)) : [];
  const local = run.qa.auth ? traces : [];
  const folder = list(`${dir(projectDir)}/.ai/qa/${run.key}`);
  const held = run.qa.auth ? folder.filter((file) => !MEDIA.test(file)) : [];
  const files = [...folder.filter((file) => !held.includes(file)), ...(run.qa.auth ? [] : traces)];
  if (files.length > 0) {
    try {
      const { attached, skipped } = await attach(run.key, files);
      const over = skipped.length > 0 ? ` Over the limit of Jira: ${skipped.map(({ name }) => name).join(', ')}.` : '';
      notes.push(`Attached to ${run.key}: ${attached.length > 0 ? attached.join(', ') : 'no file'}.${over}`);
    } catch (error) {
      notes.push(`The evidence was not attached: ${error.message}. It stays in .ai/qa/${run.key}/.`);
    }
  }
  if (held.length > 0) {
    notes.push(`Behind the basic auth of ${title(run.qa.environment)} only images and videos go to Jira, so these stay in .ai/qa/${run.key}/: ${held.map((file) => file.split('/').pop()).join(', ')}.`);
  }
  if (local.length > 0) {
    const what = local.length === 1 ? '1 Playwright trace of the run holds' : `${local.length} Playwright traces of the run hold`;
    try {
      const folder = await keep(run.key, local);
      notes.push(`The ${what} the basic auth of ${title(run.qa.environment)}, so ${local.length === 1 ? 'it is' : 'they are'} not attached: ${local.length === 1 ? 'it stays' : 'they stay'} on this machine, in ${folder}.`);
    } catch (error) {
      notes.push(`The ${what} the basic auth of ${title(run.qa.environment)}, so ${local.length === 1 ? 'it is' : 'they are'} not attached, and keeping ${local.length === 1 ? 'it' : 'them'} failed: ${error.message}.`);
    }
  }
  const now = await running(run.qa.environment);
  if (now !== run.qa.sha) {
    notes.push(`${title(run.qa.environment)} ran ${short(run.qa.sha)} when qa started and runs ${short(now)} now: the deployer replaced it during the run, so run /ao-qa ${run.key} again.`);
  }
  return notes;
}
