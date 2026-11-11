// The pure part of /ao-preview (human-loop spec 4.3): the project's .ai-orchestrator/preview.yaml, which apps to start
// and where they answer, whether the packages must be installed again, and the files of a preview that runs. ao-step
// starts and stops the processes.
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

export const PREVIEW_FILE = '.ai-orchestrator/preview.yaml';
// What /ao-preview prints when the project has no preview.yaml: the apps of ao-sample, as an example.
export const PREVIEW_SAMPLE = `# The apps /ao-preview starts, in order. B1 moves this into the project's config.
apps:
  api:
    command: npm run start:dev -w apps/api
    url: http://localhost:3001/health
  web:
    command: npm run dev -w apps/web
    url: http://localhost:3000/
    env: { API_URL: "http://localhost:3001" }`;

const NAME = /^[a-z][a-z0-9-]*$/;
const LOCAL = new Set(['localhost', '127.0.0.1']);

// The apps of preview.yaml, in order: [{ name, command, url, port, env }]. Throws with every problem when the file is
// wrong. A command is one line, which ao-step gives to the shell as it is; a URL is on this machine, with its port.
export function readPreviewConfig(text) {
  let data;
  try {
    data = parse(text);
  } catch (error) {
    throw new Error(`${PREVIEW_FILE} is not YAML: ${error.message.split('\n')[0]}`);
  }
  const problems = [];
  const apps = Object.entries(data?.apps ?? {});
  if (apps.length === 0) problems.push('it lists no app under apps');
  const read = apps.map(([name, app]) => {
    const where = `apps.${name}`;
    if (!NAME.test(name)) problems.push(`${where}: a name is lower-case letters, digits and hyphens`);
    if (typeof app?.command !== 'string' || app.command.trim() === '' || /[\r\n]/.test(app.command)) problems.push(`${where}.command: one line, the command that starts the app`);
    let url = null;
    try {
      url = new URL(app?.url);
    } catch {
      problems.push(`${where}.url: the URL where the app answers when it is up, such as http://localhost:3000/`);
    }
    if (url && (!['http:', 'https:'].includes(url.protocol) || !LOCAL.has(url.hostname) || !url.port)) problems.push(`${where}.url: http://localhost with a port, not ${app.url}`);
    const env = app?.env ?? {};
    if (typeof env !== 'object' || Array.isArray(env) || Object.values(env).some((value) => typeof value !== 'string')) problems.push(`${where}.env: names and text values`);
    return { name, command: app?.command, url: app?.url, port: url ? Number(url.port) : null, env };
  });
  if (problems.length > 0) throw new Error(`${PREVIEW_FILE}: ${problems.join('; ')}`);
  return read;
}

// The hash of a package-lock.json, to know whether the packages installed are those of the head.
export const lockHash = (text) => createHash('sha256').update(text ?? '').digest('hex');

// Whether npm ci must run: the lockfile of the head differs from the one installed last, or none is on record.
export const needsInstall = (lockText, state) => !state?.lock || state.lock !== lockHash(lockText);
