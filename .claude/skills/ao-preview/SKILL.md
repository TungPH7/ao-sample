---
name: ao-preview
description: Run the apps of an item's open PR on this machine, for the human to try before review, from the project folder on the PR branch; with --stop, stop them and go back to develop.
argument-hint: <KEY> [--stop]
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs preview $0`

## What the human wrote

$ARGUMENTS

## What to do

No agent runs here (human-loop spec 4.3).

- When the text above ends with `--stop`, run `node .ai-orchestrator/scripts/ao-step.mjs preview $0 --stop --go` with
  the Bash tool, with a timeout of 600000 ms. Then tell the human, in Vietnamese, what it stopped and the branch the
  project folder is on now, and stop.
- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop. When the check
  prints a sample `preview.yaml`, show it as it is.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs preview $0 --go` with the Bash tool, with a timeout of
  600000 ms, and wait for it. It puts the project folder on the PR branch, runs `npm ci` when the lockfile changed,
  and starts the apps, which keep running after it ends. Do not start, stop or change anything yourself.
- Then report in Vietnamese:
  - the URLs to open;
  - that the project folder is on the PR branch, and that the apps run code no reviewer has read yet, on this machine;
  - not to edit files while the preview runs;
  - to ask for changes, `/ao-fix <PR> be: … fe: …`, which stops the preview first;
  - when done, `/ao-preview <KEY> --stop`, or `/ao-review <PR>`, which stops it too.
