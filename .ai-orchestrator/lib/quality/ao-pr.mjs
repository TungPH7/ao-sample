// The commands of scripts/ao-pr.mjs (quality-gates spec section 2.2), the only way agents work on PRs: create, edit and
// comment go through the ao-dev App, review through the ao-review App. What it can check is checked before anything is
// sent. `clientFor(kind)` gives a writing GitHub client for that App; tests pass a fake one.
import { parseArgs } from 'node:util';
import { checkBranch } from '../tracker/conventions.mjs';
import { checkDescription, checkPullRequest, checkTitle, readReviewReport } from './pull-request.mjs';

const USAGE = `usage:
  ao-pr.mjs create --base <branch> --title "<type(scope): subject (KEY)>" --body-file <file> [--head <branch>]
  ao-pr.mjs edit <number> [--title "<title>"] [--body-file <file>]
  ao-pr.mjs comment <number> --body-file <file>
  ao-pr.mjs review <number> --event COMMENT|REQUEST_CHANGES --body-file <file>`;

const OPTIONS = { base: { type: 'string' }, head: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' }, event: { type: 'string' } };

export async function runAoPr(argv, { gates, clientFor, readFile, currentBranch }) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [command, number] = positionals;
  const usage = () => new Error(USAGE);
  const refuse = (problems) => new Error(`not sent:\n- ${problems.join('\n- ')}`);
  if (command !== 'create' && !/^\d+$/.test(number ?? '')) throw usage();
  const body = values['body-file'] === undefined ? undefined : readFile(values['body-file']);

  if (command === 'create') {
    if (!values.base || !values.title || body === undefined) throw usage();
    const head = values.head ?? currentBranch();
    const branch = checkBranch(head, { base: values.base });
    const problems = [...(branch.ok ? [] : [`branch: ${branch.reason}`]), ...checkPullRequest({ title: values.title, body }).problems];
    if (problems.length > 0) throw refuse(problems);
    const pr = await (await clientFor('dev')).request('POST', '/pulls', {}, { title: values.title, head, base: values.base, body });
    return `opened #${pr.number} ${pr.html_url}`;
  }
  if (command === 'edit') {
    if (values.title === undefined && body === undefined) throw usage();
    // Only what changes is checked.
    const problems = [...(values.title === undefined ? [] : checkTitle(values.title)), ...(body === undefined ? [] : checkDescription(body))];
    if (problems.length > 0) throw refuse(problems);
    await (await clientFor('dev')).request('PATCH', `/pulls/${number}`, {}, { ...(values.title !== undefined && { title: values.title }), ...(body !== undefined && { body }) });
    return `edited #${number}`;
  }
  if (command === 'comment') {
    if (body === undefined) throw usage();
    await (await clientFor('dev')).request('POST', `/issues/${number}/comments`, {}, { body });
    return `commented on #${number}`;
  }
  if (command === 'review') {
    if (!['COMMENT', 'REQUEST_CHANGES'].includes(values.event)) throw new Error('--event is COMMENT or REQUEST_CHANGES: approving is for the human');
    if (body === undefined) throw usage();
    // A report merge-gate cannot read would hold the PR back, so it is refused here.
    const report = readReviewReport(body, gates.github_apps.review.roles);
    if (!report.ok) throw refuse(report.problems);
    const github = await clientFor('review');
    // The review goes on the newest commit, the one merge-gate looks at.
    const { head } = await github.get(`/pulls/${number}`);
    await github.request('POST', `/pulls/${number}/reviews`, {}, { commit_id: head.sha, event: values.event, body });
    return `posted the ${report.role} report (${values.event}) on #${number} at ${head.sha.slice(0, 7)}`;
  }
  throw usage();
}
