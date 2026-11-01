---
name: ao-status
description: Show what waits for the human, the next command of each item, the requests between roles, and the cost of the runs; with a key, one item.
argument-hint: "[KEY]"
disable-model-invocation: true
---

## Status

!`node .ai-orchestrator/scripts/ao-step.mjs status $0`

## What to do

- Tell the human, in Vietnamese: what waits for them first, with numbered clicks for each, then the next command of
  each item, the open requests between roles, and the cost so far. Keep the item keys and the commands as they are.
- Run nothing else: no agent, no change to Jira or GitHub.
