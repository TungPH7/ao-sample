// Checks design.md files (agent-roster spec 2.8), with the images in the design/ folder next to each file: prints each
// error with its file, line and rule, and fails if any.
// Usage: node scripts/check-design.mjs <design.md> [more files]
import { checkDesignFile } from '../lib/quality/design-files.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/check-design.mjs <design.md> [more files]');
  process.exit(2);
}

for (const file of files) {
  let errors;
  try {
    errors = checkDesignFile(file);
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  if (errors.length === 0) {
    console.log(`Design OK: ${file}`);
    continue;
  }
  for (const { rule, line, message } of errors) console.error(`${file}:${line} ${rule} ${message}`);
  console.error(`${errors.length} error(s) in ${file}`);
  process.exitCode = 1;
}
