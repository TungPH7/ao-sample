---
name: ao-ship
description: Take a release on Staging to gate ⑤ (full regression, notes, release PR), or a hotfix to Production with your deployment request.
argument-hint: <vX.Y.Z>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs ship $0`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop. At gate ⑤, give the
  numbered clicks that approve the release PR on GitHub, and say not to merge it: merge-gate merges it.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs ship $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the release the check printed, and report in Vietnamese: for a
  release, the regression result, the notes devops wrote, the release PR and gate ⑤; for a hotfix, the tag, the
  deployment request and the merges back. After Production, remind the human to click Release on the Fix Version in Jira.
