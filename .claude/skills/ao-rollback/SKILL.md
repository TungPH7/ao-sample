---
name: ao-rollback
description: Ask the deployer, with your gh login, for the release that ran before on an environment, or for one commit you read.
argument-hint: <environment> [<sha>]
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs rollback $0 $1`

## What to do

- On STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- Before a GO with a commit, make sure the human read the commits that did not pass audit up to it: the request tells
  the deployer they did. If they have not, show them those commits and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs rollback $0 $1 --go` with the Bash tool in the background,
  with a timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the one the check printed, and report in Vietnamese: the deployment
  request, what the environment will run, and that the deployer answers on GitHub within a minute or two.
