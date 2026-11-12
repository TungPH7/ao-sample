---
name: ao-plan
description: Do stage plan of an Epic in Planning with sa and ba, up to gate ②; with text after the key, change the plan as the human asks before the gate; once the plan is approved, have its items refined and its docs PR merged.
argument-hint: <EPIC> [change]
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs plan $0`

## What the human wrote

$ARGUMENTS

## What to do

- The first word above is the Epic key. When more text follows it, that text is a change the human asks for in the
  plan: write it, as it is, to `.ai/runs/<KEY>/note.md`, where KEY is the Epic, and add
  `--note .ai/runs/<KEY>/note.md` to the command below. Never put that text in a shell command. With such text, run the
  command below whatever the check said: ao-step decides with the change.
- On STOP with Questions, show the human each question in Vietnamese, one list, and ask for the answers. When they
  answer, copy their reply word for word to `.ai/runs/<KEY>/answers.md`, where KEY is the Epic: add nothing, and do
  not restate the questions or the proposals. Then run the command below with `--answers .ai/runs/<KEY>/answers.md`
  added. Never put the answers in a shell command.
- On any other STOP, and no text after the key, tell the human the reason and the command or clicks it names, in
  Vietnamese, and stop. When the reason gives how many items have an effort label, say it: the human approves those
  efforts with the plan.
- On GO, run `node .ai-orchestrator/scripts/ao-step.mjs plan $0 --go` with the Bash tool in the background, with a
  timeout of 7200000 ms, and wait for its notification. Do not poll. After gate ② this run asks GitHub to run jira-sync
  with the human's gh login, which is expected.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md` and report in Vietnamese: what each agent did and cost, what changed in the plan
  and the items when the human asked for a change, the items the human must cancel, the questions left, what the
  human must do at gate ② (numbered clicks: read plan.md on the docs PR, then Approve plan on the Epic), and the next
  command.
