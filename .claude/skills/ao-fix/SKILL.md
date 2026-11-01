---
name: ao-fix
description: Fix a PR that has changes asked, red CI or a blocking finding, or what the human writes after its number, then review it again.
argument-hint: <PR> [what to fix]
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs fix $0`

## What the human wrote

$ARGUMENTS

## What to do

- The first word above is the PR number. When more text follows it, that text is what the human wants fixed: write it,
  as it is, to `.ai/runs/<KEY>/note.md`, where KEY is the item the check printed, and add
  `--note .ai/runs/<KEY>/note.md` to the command below. Never put that text in a shell command.
- On STOP, and no text after the PR number, tell the human the reason and the command or clicks it names, in
  Vietnamese, and stop. With such text, a STOP that says there is nothing to fix does not count: go on.
- On GO, or with such text, run `node .ai-orchestrator/scripts/ao-step.mjs fix $0 --go` with the Bash tool in the
  background, with a timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md` and report in Vietnamese: what each agent did and cost, whether security reviewed
  only the new part, the findings left, what the human must do at gate ③ (numbered clicks), and the next command.
