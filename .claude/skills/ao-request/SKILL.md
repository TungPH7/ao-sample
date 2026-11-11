---
name: ao-request
description: Run the open requests "Cần ba:", "Cần ux:" or "Cần sa:" on an item with the role each one asks, oldest first.
argument-hint: <KEY>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs request $0`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs request $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the item the check printed, and report in Vietnamese: each request
  that ran, what the role did and what it cost, the requests still open, and the next command. A request on an item
  past stage plan is answered on Jira only: when the role says a merged document must change, tell the human.
