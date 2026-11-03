// The context pack of a review (Pilot 1, review cost, option 2): what reviewer and security need to start, read by
// ao-step before their run and written to .ai/reviews/<PR>-context.md, so the agent does not fetch the PR, the item and
// the Epic's documents over many turns. On PR #4 of ao-sample it cut a reviewer run from 38 turns to 10. Pure: the
// script reads git, GitHub and Jira and passes the text here.

const norm = (text) => text.normalize('NFC').trim().toLowerCase();
const indentOf = (line) => line.match(/^(\s*)/)[1].length;

// The Markdown section that starts at the first heading matching `heading`, up to the next heading of the same or a
// higher level. null when there is none.
export function section(text, heading) {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => /^#+ /.test(line) && heading.test(line));
  if (from < 0) return null;
  const level = lines[from].match(/^(#+) /)[1].length;
  let to = from + 1;
  while (to < lines.length && !(/^#+ /.test(lines[to]) && lines[to].match(/^(#+) /)[1].length <= level)) to += 1;
  return lines.slice(from, to).join('\n').trim();
}

// The Task List entry of an item in plan.md: the list item whose title, after "Task 3: " or "Story 4: ", is the item's
// summary (ba copies it from the plan), with its indented lines. null when no entry has that title.
export function planEntry(plan, summary) {
  const lines = plan.split('\n');
  const title = (line) => line.match(/^(\s*)- \[[ x]\] (?:Task|Story|Bug|Spike) \d+: (.+?)(?: \(| ·|$)/);
  const from = lines.findIndex((line) => {
    const found = title(line);
    return found && norm(found[2]) === norm(summary);
  });
  if (from < 0) return null;
  const indent = indentOf(lines[from]);
  let to = from + 1;
  while (to < lines.length && (lines[to].trim() === '' || indentOf(lines[to]) > indent)) to += 1;
  return lines.slice(from, to).join('\n').trimEnd();
}

// The codes a piece of the plan names: acceptance criteria (AC3–AC6 counts every one between), ADR numbers, screens.
export function namedCodes(text) {
  const criteria = new Set();
  for (const [, first, last] of text.matchAll(/\bAC(\d+)\s*[–-]\s*AC(\d+)\b/g)) for (let n = Number(first); n <= Number(last); n += 1) criteria.add(n);
  for (const [, n] of text.matchAll(/\bAC(\d+)\b/g)) criteria.add(Number(n));
  const adrs = [...new Set([...text.matchAll(/\bADR-(\d{4})\b/g)].map(([, n]) => n))].sort();
  const screens = [...new Set([...text.matchAll(/\b(S\d+)(?:\.\d+)?\b/g)].map(([, screen]) => screen))].sort();
  return { criteria: [...criteria].sort((a, b) => a - b).map((n) => `AC${n}`), adrs, screens };
}

// The lines of the SPEC that state the given criteria ("- AC3: Given …").
export function criteriaLines(spec, codes) {
  const wanted = new Set(codes);
  return spec.split('\n').filter((line) => {
    const found = line.match(/^\s*- (AC\d+):/);
    return found && wanted.has(found[1]);
  });
}

// The subsections of the plan's API Contract whose heading names a file the PR changes, such as
// "### Dạng lỗi chung: `apps/api/src/common/api-error.ts`".
export function contractSections(plan, files) {
  const contract = section(plan, /^## API Contract/);
  if (!contract) return [];
  return contract
    .split(/\n(?=### )/)
    .filter((part) => part.startsWith('### ') && [...part.split('\n')[0].matchAll(/`([^`]+)`/g)].some(([, path]) => files.includes(path)));
}

// Plain text of an Atlassian document (a Jira description): a line per paragraph, heading and list item.
export function adfText(node, depth = 0) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  const nested = node.type === 'bulletList' || node.type === 'orderedList' ? depth + 1 : depth;
  const inner = (node.content ?? []).map((child) => adfText(child, nested)).join('');
  if (node.type === 'heading') return `\n${'#'.repeat(node.attrs?.level ?? 2)} ${inner}\n`;
  if (node.type === 'listItem') return `${'  '.repeat(Math.max(0, depth - 1))}- ${inner.trim()}\n`;
  if (node.type === 'paragraph') return `${inner}\n`;
  if (node.type === 'codeBlock') return `\n\`\`\`\n${inner}\n\`\`\`\n`;
  if (node.type === 'hardBreak') return '\n';
  return inner;
}

export const MAX_DIFF_CHARS = 150000;
const SPEC_SECTIONS = [/^#+ Rules\b/, /^#+ Non-functional requirements\b/, /^#+ Boundaries\b/];

// The pack. pr: { number, title, body, headRef, base, headSha, baseSha }; checks: ["name: conclusion"]; item: { key,
// type, summary, status, labels, parent, links, description }; docs: { epic, plan, spec, design, adrs: [{ name, text }] }
// or null without an Epic; files: [{ status, path }]; modified: [{ path, text }]; diff and stat: of base...head.
export function buildReviewPack({ pr, checks, item, docs, template, files, modified, diff, stat, maxDiffChars = MAX_DIFF_CHARS }) {
  const paths = files.map(({ path }) => path);
  const out = [
    `# Context pack: PR #${pr.number}`,
    '',
    `ao-step wrote this pack before your run, from GitHub, Jira and git at the head ${pr.headSha}. Start from it and do not fetch again what it holds. Read more only when it lacks something you need, and list in your report what you read beyond it and why.`,
    '',
    '## Pull request',
    '',
    `- #${pr.number} ${pr.title}; ${pr.headRef} → ${pr.base}; base ${pr.baseSha}, head ${pr.headSha}`,
    `- Files: ${files.map(({ status, path }) => `${status} ${path}`).join(', ')}`,
    `- Check runs on the head: ${checks.length > 0 ? checks.join('; ') : 'none'}`,
    '',
    '### Description',
    '',
    (pr.body ?? '').trim() || '(empty)',
    '',
    `## Jira item ${item.key}`,
    '',
    `- ${item.type} "${item.summary}", status ${item.status}, labels ${item.labels.join(', ') || 'none'}, parent ${item.parent ?? 'none'}, links: ${item.links.join(', ') || 'none'}`,
    '',
    item.description.trim() || '(no description)',
    '',
  ];
  out.push(...epicPart(item, docs, paths), '');
  out.push('## Review report template (`.ai-orchestrator/templates/review-report.md`)', '', template.trim(), '');
  out.push('## Full text of the modified files', '', 'Added files are whole in the diff below.', '');
  for (const { path, text } of modified) out.push(`### \`${path}\` at ${pr.headSha.slice(0, 7)}`, '', '```', text.replace(/\n$/, ''), '```', '');
  out.push(`## Diff ${pr.baseSha.slice(0, 7)}...${pr.headSha.slice(0, 7)}`, '');
  if (diff.length > maxDiffChars) {
    out.push(`The diff has ${diff.length} characters, over ${maxDiffChars}, so only its stat is here. Read it file by file with \`MSYS_NO_PATHCONV=1 git diff ${pr.baseSha.slice(0, 7)}...${pr.headSha.slice(0, 7)} -- <path>\`.`, '', '```', stat.trimEnd(), '```');
  } else {
    out.push('```diff', diff.replace(/\n$/, ''), '```');
  }
  return `${out.join('\n')}\n`;
}

function epicPart(item, docs, paths) {
  if (!docs) return ['## The Epic\'s documents', '', `${item.key} is under no Epic, so there is no SPEC or plan to quote.`];
  const out = [`## The parts of the documents of ${docs.epic} this item names`, ''];
  const entry = docs.plan ? planEntry(docs.plan, item.summary) : null;
  if (!entry) out.push(`No Task List entry of \`docs/specs/${docs.epic}/plan.md\` has the title "${item.summary}": read the plan for this item.`, '');
  else out.push(`### Plan entry (\`docs/specs/${docs.epic}/plan.md\`)`, '', entry, '');
  const contract = docs.plan ? contractSections(docs.plan, paths) : [];
  if (contract.length > 0) out.push('### API Contract sections of the changed files', '', ...contract.flatMap((part) => [part, '']));
  const codes = namedCodes([entry ?? '', ...contract].join('\n'));
  if (docs.spec) {
    const criteria = criteriaLines(docs.spec, codes.criteria);
    if (criteria.length > 0) out.push(`### Acceptance criteria the entry names (\`docs/specs/${docs.epic}/spec.md\`)`, '', ...criteria, '');
    for (const heading of SPEC_SECTIONS) {
      const part = section(docs.spec, heading);
      if (part) out.push(part.replace(/^#+ /, '### SPEC: '), '');
    }
  }
  if (docs.design) {
    for (const screen of codes.screens) {
      const part = section(docs.design, new RegExp(`^#+ ${screen} `));
      if (part) out.push(part.replace(/^#+ /, '### Design: '), '');
    }
  }
  for (const { name, text } of docs.adrs.filter(({ name }) => codes.adrs.some((n) => name.startsWith(`${n}-`)))) out.push(`### ADR \`docs/adr/${name}\``, '', text.trim(), '');
  return out;
}
