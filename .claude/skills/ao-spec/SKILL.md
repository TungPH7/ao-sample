---
name: ao-spec
description: Do stage spec of an Epic in Specifying with ba, ux and sa, up to its docs PR at gate ①.
argument-hint: <EPIC>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs spec $0`

## What to do

- On STOP with Questions, show the human each question in Vietnamese, one list, and ask for the answers. When they
  answer, write the answers, as they are, to `.ai/runs/<KEY>/answers.md`, where KEY is the Epic, and run the command
  below with `--answers .ai/runs/<KEY>/answers.md` added. Never put the answers in a shell command.
- On any other STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs spec $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md` and report in Vietnamese: what each agent did and cost, the questions left (as
  above), what the human must do at gate ① (numbered clicks: read the docs PR, then Approve spec on the Epic), and the
  next command.
