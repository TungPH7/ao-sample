---
name: ao-build
description: Build a Ready item of the SDLC contract with its dev agent, up to an open PR with CI done.
argument-hint: <KEY>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs build $0`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs build $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the item the check printed, and report in Vietnamese: what each
  agent did and cost, the questions left, what the human must do at a gate (numbered clicks), and the next command.
