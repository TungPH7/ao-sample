---
name: ao-intake
description: Turn a rough description into one Jira item of the SDLC contract, an Epic, a Task or a Bug, after an interview with the human. Start spec stays the human's click.
argument-hint: <rough description>
disable-model-invocation: true
---

## Check

!`node .ai-orchestrator/scripts/ao-step.mjs intake`

## What the human wrote

$ARGUMENTS

## What to do

No agent runs here: you, the main session, do the intake with the human (human-loop spec 3.1). Speak Vietnamese with
them. Write no code, and change nothing in the repository but the draft below.

1. **Interview.** Follow the interview-me skill: one question at a time, until you could write the item without
   guessing who it is for, what problem it solves, what done looks like, what is out of scope, and its constraints.
   When the idea is still vague, or the human asks for options, use the thinking steps of the idea-refine skill; do not
   run its script, and write nothing in `docs/ideas/`. Stop asking when the human says it is enough. Look at the Epics
   the check printed: when the description repeats one, say so before going on.
2. **Sort it** with the rule the check printed:
   - an Epic: a result the end user sees, which needs a SPEC and a plan;
   - a Task: technical work whose result the end user does not see;
   - a Bug: behaviour that is wrong against a requirement that exists already.

   You never make a Story: a Story needs acceptance criteria in a SPEC, screens and an API contract, which only stage
   spec and plan write. Work the size of one Story, and a new capability for an Epic past gate ②, become a small Epic
   of their own; say so, and link the new Epic to the old one with "relates to" in its header.
3. **Draft.** Write `.ai/intake/<YYYYMMDD-HHmm>-<slug>.md` from `.ai-orchestrator/templates/epic.md`, `task.md` or
   `bug.md`. Put in it only what the human said or approved. What is not settled goes under Open Points of an Epic, or
   you ask it. Copy the human's first description word for word under Original Request. Delete the template's guidance
   comments and its Example section.
4. **Summary.** Show the human, in Vietnamese: the type and why, the title, the scope, the open points, and the path of
   the draft. For a Bug, also Found in, and the Severity and Affects Version you propose, which the human approves. Ask
   them to answer OK or say what to change. Change the draft and show the summary again until they say OK.
5. **Create.** Only after the human's OK, create the item once with the createJiraIssue tool of the atlassian server:
   the cloud id of `.claude/rules/ai-orchestrator.md`, the space the check printed, the type, the summary from the
   draft's first line, and the rest of the draft as the description, in markdown. For a Bug, also set Found in,
   Severity and Affects Version, with the field ids the check printed; leave Fix Version empty. This is the one Jira
   write you make: no transition, no comment, no edit of another item. If the call fails, show the error and stop: do
   not try another way.
6. **Report.** Run `node .ai-orchestrator/scripts/ao-step.mjs status <KEY>` with the key Jira gave, and show its output.
   Then tell the human, in Vietnamese, the key, its link, and the next step as numbered clicks: for an Epic, Start spec
   on it, then `/ao-spec <KEY>`; for a Task or a Bug, read it on Jira, then Refine.
