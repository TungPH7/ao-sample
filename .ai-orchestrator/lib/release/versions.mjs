// Release numbers (release-workflow spec 2.6): the first release is v0.1.0, each next release raises the minor of the
// newest tag, and a hotfix raises the patch of the release running on Production. You decide when to raise the major,
// by passing your own number to /ao-release. Pure functions over tag names; a tag of another form than
// v<major>.<minor>.<patch> is ignored.

const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// { major, minor, patch } of a tag such as v0.1.0, or null when the tag has another form.
export function parseVersion(tag) {
  const match = typeof tag === 'string' ? VERSION.exec(tag) : null;
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

const format = ({ major, minor, patch }) => `v${major}.${minor}.${patch}`;
const compare = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

// The newest release among `tags`, by number rather than by date or list order, or null when none has the form.
export function latestTag(tags) {
  const versions = tags.map(parseVersion).filter(Boolean);
  return versions.length > 0 ? format(versions.reduce((a, b) => (compare(a, b) >= 0 ? a : b))) : null;
}

// The number of the next release: v0.1.0 when no tag has the form, else the minor of the newest tag plus one.
export function nextRelease(tags) {
  const latest = parseVersion(latestTag(tags));
  return latest ? format({ major: latest.major, minor: latest.minor + 1, patch: 0 }) : 'v0.1.0';
}

// The number of the next hotfix of `production`, the release running on Production: one above the highest patch tagged
// on its major.minor, so a patch that was tagged and then rolled back keeps its number. Null when Production runs no
// release.
export function nextPatch(tags, production) {
  const running = parseVersion(production);
  if (!running) return null;
  const line = tags.map(parseVersion).filter((v) => v && v.major === running.major && v.minor === running.minor);
  const patch = Math.max(running.patch, ...line.map((v) => v.patch)) + 1;
  return format({ ...running, patch });
}
