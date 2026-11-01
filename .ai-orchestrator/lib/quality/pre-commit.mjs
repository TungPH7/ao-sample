// The secret scan of the pre-commit hook (quality-gates spec section 2.3). It lints what is staged, not what is on
// disk, since the commit takes the staged text. `read` gives a file's staged text and `lint` is secretlint's
// executeOnContent, so tests can pass their own.

// Binary files are left to gitleaks in CI.
const isBinary = (text) => text.includes('\0');

export async function scanStaged({ files, read, lint }) {
  const outputs = [];
  for (const file of files) {
    const content = read(file);
    if (isBinary(content)) continue;
    const { ok, output } = await lint({ content, filePath: file });
    if (!ok) outputs.push(output.trim());
  }
  return { ok: outputs.length === 0, output: outputs.join('\n') };
}
