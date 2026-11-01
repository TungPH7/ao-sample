// Reads a design.md and the images in the design/ folder next to it, then checks them with lib/quality/design.mjs.
// Shared by scripts/check-design.mjs and the policy job (scripts/check-policy.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkDesign } from './design.mjs';

// The files of the design/ folder next to a design.md, as file name → bytes; none when the folder does not exist.
export function readDesignImages(file) {
  const dir = join(dirname(file), 'design');
  if (!existsSync(dir)) return new Map();
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile());
  return new Map(entries.map(({ name }) => [name, readFileSync(join(dir, name))]));
}

export function checkDesignFile(file) {
  return checkDesign(readFileSync(file, 'utf8'), { images: readDesignImages(file) });
}
