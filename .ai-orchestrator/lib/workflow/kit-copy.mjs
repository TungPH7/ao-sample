// A PR that copies a kit another project already reviewed (kit-copy-review spec 2.1, 2.2): ao-step compares it with the
// head of that review and writes the two reports itself, with no agent. The claim in the PR description proves nothing:
// everything is checked here against what GitHub says. Any doubt falls back to the review by the agents, so nothing here
// can let a PR through unread that would not have been read anyway. decideKitCopy and kitCopyReport are pure.
import { matchesGlob } from '../quality/glob.mjs';
import { botLogin, reportGaps } from '../quality/merge-gate.mjs';

const CLAIM = /^Kit review:[ \t]*([\w.-]+\/[\w.-]+)#(\d+)[ \t\r]*$/gm;
const MARK = 'Kit copy of:';
const MARKED = new RegExp(`^${MARK}`, 'm');

// The PR the description points at, or null without exactly one line of the right form.
export function kitReviewOf(body) {
  const found = [...(body ?? '').matchAll(CLAIM)];
  return found.length === 1 ? { repo: found[0][1], number: Number(found[0][2]) } : null;
}

const within = (globs, path) => globs.some((glob) => matchesGlob(glob, path));
// What a tree holds at each path: kind, mode and content, so a link or a file made executable counts as a change.
const entries = ({ tree }) => new Map(tree.filter(({ type }) => type !== 'tree').map(({ path, type, mode, sha }) => [path, `${type} ${mode} ${sha}`]));

// claim: { repo, number }, from kitReviewOf. peers: the repositories of AO_KIT_PEERS. headTree and baseTree: GET
// /git/trees/{sha}?recursive=1 of the head and of the merge base, so what the PR changes is read by SHA, with no list
// GitHub cuts short (review of ao-pilot PR #24). reference: { pull, reviews, newest, tree }, where newest is the newest
// commit of its base on gates.kit_copy.newest_path. Returns { ok: false, reason } or
// { ok: true, compared, reference: { repo, number, head } }. The content of the rendered files is left to the render
// check that follows.
export function decideKitCopy({ claim, peers, headTree, baseTree, reference, gates, apps, approvers }) {
  const no = (reason) => ({ ok: false, reason });
  const name = `${claim.repo}#${claim.number}`;
  if (!peers.includes(claim.repo)) return no(`${claim.repo} is not in AO_KIT_PEERS`);
  const { pull, reviews, newest, tree } = reference;
  if (!pull.merged_at) return no(`${name} is not merged`);
  if (!gates.protected_branches.some((glob) => matchesGlob(glob, pull.base.ref))) return no(`${name} was merged into ${pull.base.ref}, not a protected branch`);
  if (!approvers.includes(pull.merged_by?.login)) return no(`${name} was merged by ${pull.merged_by?.login}, not by you`);

  const head = pull.head.sha;
  const bot = botLogin(apps.review);
  const gaps = reportGaps(reviews, head, `on head ${head.slice(0, 7)}`, gates.github_apps.review.roles, bot);
  if (gaps.length > 0) return no(`${name} lacks: ${gaps.join('; ')}`);
  // A copy of a copy would hide how far the real review is.
  if (reviews.some((r) => r.user?.login === bot && r.commit_id === head && MARKED.test(r.body ?? ''))) return no(`${name} is a kit copy too: point at the PR the agents reviewed`);
  const rule = gates.kit_copy;
  if (newest !== pull.merge_commit_sha) return no(`${name} is not the newest PR of ${claim.repo} on ${rule.newest_path}`);
  if (headTree.truncated) return no('the tree of the head is too large for GitHub to list');
  if (baseTree.truncated) return no('the tree of the merge base is too large for GitHub to list');
  if (tree.truncated) return no(`the tree of ${name} is too large for GitHub to list`);

  const ours = entries(headTree);
  const before = entries(baseTree);
  const theirs = entries(tree);
  const compared = new Set();
  const differs = (path) => {
    compared.add(path);
    return (ours.get(path) ?? null) !== (theirs.get(path) ?? null);
  };
  const union = (...maps) => [...new Set(maps.flatMap((map) => [...map.keys()]))].sort();
  // What the PR changes: a file added, removed or changed; a renamed file by both names.
  for (const path of union(before, ours).filter((p) => (before.get(p) ?? null) !== (ours.get(p) ?? null))) {
    if (within(rule.rendered, path)) continue;
    if (!within([...rule.same, ...rule.same_when_changed], path)) return no(`the PR changes ${path}, which is not a kit file`);
    // A skill only this project has is missing from the reference too, which is no match (review of ao-pilot PR #24).
    if (within(rule.same_when_changed, path) && !ours.has(path)) return no(`the PR removes ${path}, which only a review can judge`);
    if (differs(path)) return no(`${path} differs from ${name}`);
  }
  // Both ways: a part of the copy left out, or a file added beside it, is a kit nobody reviewed as a whole.
  for (const path of union(ours, theirs).filter((p) => within(rule.same, p))) {
    if (differs(path)) return no(`${path} differs from ${name}`);
  }
  // The rendered files hold the space key of each project, so they are not compared with it. The render check that
  // follows says which of them render-agents writes and whether they match their sources; here they must be plain files,
  // since a link or a submodule there would be read through.
  for (const path of [...ours.keys()].filter((p) => within(rule.rendered, p))) {
    compared.add(path);
    if (ours.get(path).split(' ', 2).join(' ') !== 'blob 100644') return no(`${path} is not a plain file`);
  }
  return { ok: true, compared: compared.size, reference: { repo: claim.repo, number: claim.number, head } };
}

// Reads what decideKitCopy needs and decides. null when the PR makes no claim or the kit has no kit_copy block; on any
// error { ok: false, reason }, so a PR is never held up by this and never passes on it unread. github: the project's
// client; peer(repo): a reading client of another repository; render(sha): renders the rendered files again, and
// resolves to null or the reason they differ. A repository outside peers is not opened: your login reads only those.
export async function readKitCopy({ pr, github, peer, peers, gates, apps, approvers, render }) {
  const claim = kitReviewOf(pr.body);
  if (!claim || !gates.kit_copy) return null;
  if (!peers.includes(claim.repo)) return { ok: false, reason: `${claim.repo} is not in AO_KIT_PEERS` };
  try {
    const client = peer(claim.repo);
    const pull = await client.get(`/pulls/${claim.number}`);
    const reviews = await client.getAll(`/pulls/${claim.number}/reviews`);
    // On develop of the peer, whatever branch the reference was merged into: a PR merged into a release branch would
    // otherwise lead back to an older kit (review of ao-pilot PR #24).
    const [newest] = await client.get('/commits', { path: gates.kit_copy.newest_path, sha: gates.kit_copy.newest_branch, per_page: 1 });
    const tree = await client.get(`/git/trees/${pull.head.sha}`, { recursive: 1 });
    const head = pr.headSha;
    // The base by its merge base with the head, as the diff of the PR has it; branch names keep their slashes.
    const { merge_base_commit: mergeBase } = await github.get(`/compare/${encodeURIComponent(pr.base).replaceAll('%2F', '/')}...${head}`);
    const baseTree = await github.get(`/git/trees/${mergeBase.sha}`, { recursive: 1 });
    const headTree = await github.get(`/git/trees/${head}`, { recursive: 1 });
    // The reports go on this head: after a push, say so rather than post on a head that is no longer the PR's.
    const now = (await github.get(`/pulls/${pr.number}`)).head.sha;
    if (now !== head) return { ok: false, reason: `the head of PR #${pr.number} moved from ${head.slice(0, 7)} while it was compared` };
    const decision = decideKitCopy({ claim, peers, headTree, baseTree, reference: { pull, reviews, newest: newest?.sha, tree }, gates, apps, approvers });
    if (!decision.ok) return decision;
    // Always: sources changed without their rendered files would leave the agents of the project stale.
    const rendered = headTree.tree.filter(({ type, path }) => type !== 'tree' && within(gates.kit_copy.rendered, path)).map(({ path }) => path);
    const wrong = await render(head, rendered);
    return wrong ? { ok: false, reason: wrong } : decision;
  } catch (error) {
    return { ok: false, reason: `could not read the reference: ${error.message}` };
  }
}

// Why the rendered files at `sha` are not what their sources give, or null (spec 2.3). paths: the files of the head
// among the rendered ones; tree: { add, remove }, a copy of the head that no agent reads, removed whatever happens;
// render(path): { status, text, files }, the outcome of render-agents.mjs --check and the files --list names.
export function renderedReason({ sha, paths, tree, render }) {
  const short = sha.slice(0, 7);
  const added = tree.add();
  if (!added.ok) return `the tree of ${short} could not be made: ${added.reason}`;
  try {
    const { status, text, files } = render(added.path);
    if (status !== 0) return `the rendered files at ${short} do not match their sources: ${text.trim()}`;
    // --check compares only the files it renders: one beside them would be read by no one (review of ao-pilot PR #24).
    const extra = paths.filter((path) => !files.includes(path));
    return extra.length > 0 ? `the PR has ${extra.join(', ')} among the rendered files, which render-agents does not write` : null;
  } finally {
    tree.remove();
  }
}

// Posts the reports on the head that was compared, never on the head of the moment (spec 2.4): after a push they stay on
// the old head, and merge-gate asks for new ones. github: a client of the ao-review App.
export async function postKitCopyReports({ github, step }) {
  const { number, title, key, sha, roles, reference, compared } = step;
  const notes = [];
  for (const role of roles) {
    await github.request('POST', `/pulls/${number}/reviews`, {}, { commit_id: sha, event: 'COMMENT', body: kitCopyReport({ role, pr: { title }, key, reference, compared }) });
    notes.push(`Posted the ${role} report of PR #${number} on ${sha.slice(0, 7)}: a copy of ${reference.repo}#${reference.number}, ${compared} files compared, no agent ran.`);
  }
  return notes;
}

// The report of one role, in the form of templates/review-report.md, for the head ao-step compared.
export function kitCopyReport({ role, pr, key, reference, compared }) {
  const title = pr.title.endsWith(`(${key})`) ? pr.title : `${pr.title} (${key})`;
  const source = `${reference.repo}#${reference.number}`;
  return `${[
    `# Review: ${title}`,
    '',
    `Role: ${role}`,
    `${MARK} ${source} at ${reference.head}`,
    '',
    '## Context',
    '',
    `Không agent nào đọc PR này. \`ao-step\` so ${compared} file của bản chép kit với head của ${source}, nơi \`reviewer\` và \`security\` đã review đầy đủ, và file nào cũng khớp về nội dung, mode và loại. Các file render lại đã được dựng lại từ nguồn ở head của PR.`,
    '',
    '## Findings',
    '',
    '| Severity | Axis | Where | Finding | Suggested fix |',
    '|---|---|---|---|---|',
    '',
    '## Verdict',
    '',
    `Không có finding mới, vì nội dung giống hệt bản đã review ở ${source}. Bạn vẫn đọc diff và merge ở gate ③.`,
  ].join('\n')}\n`;
}
