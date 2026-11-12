---
name: ao-fix
description: Fix a PR that has changes asked, red CI or a blocking finding, or what the human writes after its number, then review it again; on a draft PR the dev agents fix it with no review, for another preview.
argument-hint: <PR> [what to fix]
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs fix $0`

## What the human wrote

$ARGUMENTS

## What to do

- The first word above is the PR number. When more text follows it, that text is what the human wants fixed: write it,
  as it is, to `.ai/runs/<KEY>/note.md`, where KEY is the item the check printed, and add
  `--note .ai/runs/<KEY>/note.md` to the command below. Never put that text in a shell command. A part that starts a
  line with `be:` or `fe:` goes to `be-dev` or `fe-dev`; leave the prefixes as the human wrote them.
- With such text, before you run anything, ask the human one question in Vietnamese: what does the request change?
  Read the request and the acceptance criteria of the item (`getJiraIssue`), then propose one answer and ask them to
  say OK or pick another:
  - `none`: the code only, every acceptance criterion stays as it is;
  - `ac`: an acceptance criterion of the item; `ba` updates it on Jira and in the SPEC first;
  - `api`: the API contract of the plan; `sa` updates it first;
  - `epic`: a requirement of the whole Epic; `sa` updates the SPEC, plan or ADR first, and lists the other items it
    touches;
  - `story`: a Task gets behaviour the end user sees, so `ba` turns it into a Story first.

  When the request is a new capability, changes what a Bug was expected to do, or changes the direction of the Epic,
  say so and stop: that goes through `/ao-intake`, not this PR. Add `--change <word>` with the human's answer to the
  command below; the word is one of the five above, never their own words.
- On STOP, and no text after the PR number, tell the human the reason and the command or clicks it names, in
  Vietnamese, and stop. With such text, a STOP that says there is nothing to fix does not count: go on.
- On GO, or with such text, run `node .ai-orchestrator/scripts/ao-step.mjs fix $0 --go` with the Bash tool in the
  background, with a timeout of 7200000 ms, and wait for its notification. Do not poll.
  Do not run any agent yourself, and do not change Jira or GitHub yourself.
- Then read `.ai/runs/<KEY>/last.md` and report in Vietnamese: what each agent did and cost, what `ba` or `sa` changed
  in the criteria or the documents, whether security reviewed only the new part, the findings left, and the next
  step. On a draft PR that is `/ao-preview <KEY>` to look again, or `/ao-review <PR>`; on a ready PR, what the human
  must do at gate ③ (numbered clicks).
