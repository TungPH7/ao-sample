---
name: ao-plan
description: Do stage plan of an Epic in Planning with sa and ba, up to gate ②; once the plan is approved, have its items refined and its docs PR merged.
argument-hint: <EPIC>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs plan $0`

## What to do

- On STOP with Questions, show the human each question in Vietnamese, one list, and ask for the answers. When they
  answer, write the answers, as they are, to `.ai/runs/<KEY>/answers.md`, where KEY is the Epic, and run the command
  below with `--answers .ai/runs/<KEY>/answers.md` added. Never put the answers in a shell command.
- On any other STOP, tell the human the reason and the command or clicks it names, in Vietnamese, and stop. When the
  reason gives how many items have an effort label, say it: the human approves those efforts with the plan.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs plan $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll. After gate ② this run asks GitHub to run jira-sync
  with the human's gh login, which is expected.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md` and report in Vietnamese: what each agent did and cost, the questions left, what
  the human must do at gate ② (numbered clicks: read plan.md on the docs PR, then Approve plan on the Epic), and the
  next command.
