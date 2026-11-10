// The pure parts of the last step of /ao-ship vX.Y.0 (release-workflow spec 2.7): the result of the regression report,
// and CHANGELOG.md with the section of the release.

// The line "Result: PASS" or "Result: FAIL" that qa ends the Regression Result section with; null without one.
export function regressionResult(text) {
  return /^Result:\s*(PASS|FAIL)\b/m.exec(text ?? '')?.[1] ?? null;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `current`: CHANGELOG.md, or null when there is none. The section goes under its title, before the older releases. A
// changelog that has a heading of the release already, with or without the v, gets the new section in place of the
// old one, up to the next heading of a release: devops writes the notes again when the regression ran again (T21).
export function changelogWith(current, section, version) {
  const body = `${section.trim()}\n`;
  if (current === null) return `# Changelog\n\n${body}`;
  const heading = new RegExp(`^##\\s+\\[?v?${escape(version.replace(/^v/, ''))}\\]?(?=\\s|$)`, 'm');
  const at = current.search(heading);
  if (at >= 0) {
    const next = current.slice(at + 1).search(/^##\s+\[?v?\d+\.\d+/m);
    const end = next < 0 ? current.length : at + 1 + next;
    // The blank lines that closed the old section close the new one, so the same notes give the same file.
    const trailing = /\n*$/.exec(current.slice(at, end))[0] || '\n';
    return `${current.slice(0, at)}${body.trimEnd()}${trailing}${current.slice(end)}`;
  }
  const title = /^# .*\n(\n)?/.exec(current);
  if (!title || title.index !== 0) return `${body}\n${current}`;
  return `${current.slice(0, title[0].length)}${title[1] ? '' : '\n'}${body}\n${current.slice(title[0].length)}`;
}
