---
name: ao-review
description: Review a PR with CI green on its head, with reviewer and then security, up to both reports at gate ③.
argument-hint: <PR>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs review $0`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs review $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the item the check printed, and report in Vietnamese: what each
  agent did and cost, the findings by severity, whether security reviewed the whole PR or only the new part, what the
  human must do at gate ③ (numbered clicks), and the next command.
