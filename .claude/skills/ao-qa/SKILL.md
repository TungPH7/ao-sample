---
name: ao-qa
description: QA an item in Ready for QA with the qa agent, on the environment that runs its merge, and attach the evidence to Jira; with "fail:" and a defect the human found, qa reproduces it and fails the item.
argument-hint: "<KEY> [fail: <defect, steps, expected result>]"
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs qa $0`

## What the human wrote

$ARGUMENTS

## What to do

- The first word above is the item key. When the text after it starts with `fail:`, the rest is a defect the human
  found (human-loop spec 5.1): write it, as it is, to `.ai/runs/<KEY>/note.md`, where KEY is the item, and add
  `--note .ai/runs/<KEY>/note.md` to the command below. Never put that text in a shell command.
- With such a defect, before you run anything, ask the human one question in Vietnamese, with your proposal, after
  reading the acceptance criteria of the item (`getJiraIssue`):
  - `none`: it breaks an acceptance criterion of the item (say which);
  - `ac`: it is a new expectation no criterion covers; `ba` adds the criterion on Jira first, and qa then fails it;
  - outside the item: say so and stop; the human reports it as a Bug with `/ao-intake`.

  Add `--change none` or `--change ac` with the human's answer to the command below, then run it whatever the check
  said: ao-step decides with the defect.
- On STOP, and no defect, tell the human the reason and the command or clicks it names, in Vietnamese, and stop.
- On GO, or with a defect, run `node .ai-orchestrator/scripts/ao-step.mjs qa $0 --go` with the Bash tool in the
  background, with a timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md`, where KEY is the item the check printed, and report in Vietnamese: the QA result
  and the verdict of each criterion, the files attached to the item, whether a deploy came during the run, what the
  run cost, and the next step: on PASS, that Accept on the item is the human's click (numbered clicks); on FAIL, that
  `/ao-build <KEY>` builds the fix on a new branch; when qa could not reproduce the defect, what it tried.
