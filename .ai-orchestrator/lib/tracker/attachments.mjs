// The evidence of qa on its work item (release-workflow spec 2.5): after the qa run, the script attaches the files qa
// left with the CI token, in your session, then comments the list. The agent's own token only reads (T1 of the plan,
// point 8), and the CI token never enters the agent's environment. Jira says its own upload limit; a file over it is
// left out, and the comment names it.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const MB = 1024 * 1024;
const size = (bytes) => `${(bytes / MB).toFixed(1)} MB`;

// jira: a writing client (lib/tracker/jira-client.mjs, made with the CI token). files: paths. Returns { attached,
// skipped }, names of files, each skipped one with its size.
export async function attachEvidence({ jira, key, files, fs = { readFile, stat } }) {
  if (files.length === 0) return { attached: [], skipped: [] };
  const { enabled, uploadLimit } = await jira.get('/rest/api/3/attachment/meta');
  const sized = [];
  for (const path of files) sized.push({ path, name: basename(path), size: (await fs.stat(path)).size });

  if (!enabled) {
    const skipped = sized.map(({ name, size: bytes }) => ({ name, size: bytes }));
    await jira.comment(key, `ao-step: attachments are off on this Jira, so the evidence of qa stays in .ai/qa/: ${skipped.map(listed).join(', ')}.`);
    return { attached: [], skipped };
  }
  const attached = [];
  const skipped = [];
  for (const { path, name, size: bytes } of sized) {
    if (bytes > uploadLimit) {
      skipped.push({ name, size: bytes });
      continue;
    }
    await jira.attach(key, name, await fs.readFile(path));
    attached.push(name);
  }
  const over = skipped.length > 0 ? ` Not attached, over the limit of ${size(uploadLimit)} on this Jira: ${skipped.map(listed).join(', ')}.` : '';
  await jira.comment(key, `ao-step: attached the evidence of qa: ${attached.length > 0 ? attached.join(', ') : 'no file'}.${over}`);
  return { attached, skipped };
}

const listed = ({ name, size: bytes }) => `${name} (${size(bytes)})`;
