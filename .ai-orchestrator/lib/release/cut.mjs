// Cut point (release-workflow spec 2.6, docs/sdlc.md): the newest commit on the first-parent history of develop such
// that every item with a commit up to it is Done, and none of those items has a commit after it. Items after the cut
// point go to the next release. A pure function: the caller reads the history with git and the states from Jira.

// commits: the first-parent history of develop since the newest release tag, oldest first, each { sha, subject, keys }
// with the work item keys it names. items: the contract state of each item by key ('done', 'in-qa', ...).
// Returns { cut, included, after }: `cut` is the commit of the cut point, or null when no commit up to a cut point holds
// a Done item (guard cut-point-ready); `included` and `after` list { key, state }, in the order of each item's first
// commit. Only Done counts: a Cancelled item, or one without a state, holds the cut point back until you sort it out.
// epics: the keys that are Epics. An Epic is not released, its children are, and it completes only after they reach
// Production, so a commit that names one, such as its spec, goes with the cut point that covers it.
export function cutPoint({ commits, items, epics = [] }) {
  const state = (key) => (Object.hasOwn(items, key) ? items[key] : null);
  const skipped = new Set(epics);
  const work = commits.map(({ keys }) => keys.filter((key) => !skipped.has(key)));
  const last = new Map();
  work.forEach((keys, i) => keys.forEach((key) => last.set(key, i)));

  let cut = -1;
  let reach = -1; // the last commit of any item met so far
  for (const [i, keys] of work.entries()) {
    if (keys.some((key) => state(key) !== 'done')) break;
    for (const key of keys) reach = Math.max(reach, last.get(key));
    if (reach <= i) cut = i;
  }

  const order = [...new Set(work.flat())];
  const released = new Set(work.slice(0, cut + 1).flat());
  const list = (keys) => keys.map((key) => ({ key, state: state(key) }));
  return {
    cut: released.size > 0 ? commits[cut] : null,
    included: list(order.filter((key) => released.has(key))),
    after: list(order.filter((key) => !released.has(key))),
  };
}
