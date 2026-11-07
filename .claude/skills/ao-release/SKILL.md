---
name: ao-release
description: Print the cut point of develop and the items of the next release; with the release and the cut point, cut the release branch at gate ④.
argument-hint: '[<vX.Y.0> <sha>]'
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs release $0 $1`

## What to do

- On STOP, tell the human in Vietnamese what the check printed: the cut point, the items in the release and after it,
  the Fix Versions on Jira, and the reason. At gate ④, give the exact command that approves the list, such as
  `/ao-release v0.1.0 22327a5`. When a Fix Version is missing, give the numbered clicks that create it in Jira. Stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs release $0 $1 --go` with the Bash tool in the background, with
  a timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the release the check printed, and report in Vietnamese: the
  release branch, the Fix Versions set and moved, and that the deployer puts the branch on Staging; next comes
  `/ao-ship <version>`.
