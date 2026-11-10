---
name: ao-qa
description: QA an item in Ready for QA with the qa agent, on the environment that runs its merge, and attach the evidence to Jira.
argument-hint: <KEY>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs qa $0`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs qa $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the item the check printed, and report in Vietnamese: the QA result
  and the verdict of each criterion, the files attached to the item, whether a deploy came during the run, what the
  run cost, and, on PASS, that Accept on the item is the human's click (numbered clicks).
