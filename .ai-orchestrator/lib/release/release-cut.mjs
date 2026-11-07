// The parts of /ao-release <vX.Y.0> <sha> that are pure (release-workflow spec 2.6): the first-parent history of develop
// as git prints it, the release after one, and the Jira changes of a cut: the Fix Version of each item in the release,
// the items after the cut point that carried it moved to the next release, and a comment on each.
import { extractKeys } from '../tracker/conventions.mjs';
import { parseVersion } from './versions.mjs';

const TAB = '\t';

// The output of `git log --first-parent --reverse --format=%H%x09%s`: commits oldest first, each with the keys of the
// project space its subject names, as cutPoint takes them.
export function parseHistory(text, space) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(TAB);
      const subject = line.slice(at + 1);
      return { sha: line.slice(0, at), subject, keys: [...new Set(extractKeys(subject))].filter((key) => key.startsWith(`${space}-`)) };
    });
}

// The release after vX.Y.Z: vX.(Y+1).0.
export function nextMinor(version) {
  const { major, minor } = parseVersion(version);
  return `v${major}.${minor + 1}.0`;
}

// included, after: items as { key, fixVersions }. Returns { fixVersions: [{ key, names }], comments: [{ key, text }] }.
export function releaseCutChanges({ version, nextVersion, sha, approvedAt, included, after }) {
  const fixVersions = [];
  const comments = [];
  for (const { key } of included) {
    fixVersions.push({ key, names: [version] });
    comments.push({ key, text: `ao-step: ${key} is in ${version}, cut at ${sha.slice(0, 8)} on develop. You approved the list at gate ④ on ${approvedAt}.` });
  }
  for (const { key, fixVersions: names } of after.filter(({ fixVersions: names }) => names.includes(version))) {
    fixVersions.push({ key, names: [...new Set(names.map((name) => (name === version ? nextVersion : name)))] });
    comments.push({ key, text: `ao-step: ${key} is after the cut point of ${version}, so its Fix Version moved to ${nextVersion}.` });
  }
  return { fixVersions, comments };
}
