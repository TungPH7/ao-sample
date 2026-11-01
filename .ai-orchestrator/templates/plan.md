<!--
Template for the `plan` artifact in contract/policies.yaml: the plan of one Epic, saved as docs/specs/<EPIC-KEY>/plan.md.
Sections follow the plan template of agent-skills' planning-and-task-breakdown, plus an API Contract section.
Tasks live in Jira instead of tasks/todo.md, so the Task List is an ordered index of Jira keys (the skill's external
tracker convention). Keep headings in English and write the content in Vietnamese.
Delete the guidance comments and the Example section when you are done.
-->

# Implementation Plan: <Epic name>

> **Epic:** <EPIC-KEY> · **Jira:** <link to the Epic> · **Spec:** [spec.md](spec.md) · **Tasks:** tracked in Jira under <EPIC-KEY>

## Overview

<!-- One paragraph: what the Epic delivers, and in which order. -->

## Architecture Decisions

<!-- Each key decision with its reason. A decision that is expensive to reverse also gets an ADR (templates/adr.md). -->

## API Contract

<!-- For every Story that has both FE and BE Sub-tasks: the endpoints, the request and response types, and the errors.
The BE Sub-task puts the types in the shared types package of the monorepo, so a mismatch fails the type check. -->

## Task List

<!-- Ordered index of the Jira Stories and Tasks this plan creates, grouped by phase, with a checkpoint after each phase.
Shared groundwork, such as the auth module or the schema of the Epic, is an independent Task that comes first.
The details of each item live in Jira, written from templates/story.md or templates/task.md.
After each title: the dev roles that build the item (be-dev, fe-dev, devops), with "(Sub-task)" when each role gets a
Sub-task of a Story; and, only for a hard item, its effort xhigh or max with the reason. You approve the efforts at gate
② plan-approval, and ba turns roles and efforts into labels. -->

### Phase 1: <name>
- [ ] <KEY>: <Story or Task title> · <roles> · effort <xhigh | max>: <reason, only for a hard item>

### Checkpoint: <name>
- [ ] <What must work before the next phase>

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| <...> | High / Medium / Low | <...> |

## Open Questions

<!-- What still needs your decision before gate ② plan-approval. -->

## Example

<details>
<summary>Ví dụ: plan của Epic "Đăng nhập" (DEMO-10)</summary>

````markdown
# Implementation Plan: Đăng nhập

> **Epic:** DEMO-10 · **Jira:** https://example.atlassian.net/browse/DEMO-10 · **Spec:** [spec.md](spec.md) · **Tasks:** tracked in Jira under DEMO-10

## Overview
Làm module auth dùng chung trước, rồi đăng nhập bằng email và mật khẩu, cuối cùng là khóa tài khoản khi nhập sai nhiều lần.

## Architecture Decisions
- JWT nằm trong cookie httpOnly, không để ở localStorage, để lỗi XSS không lấy được token (ADR-0003).

## API Contract
`POST /auth/login` (DEMO-12)
- Request: `{ email: string; password: string }`
- 200: `{ user: { id: string; email: string } }`, kèm cookie `access_token`
- 401: `{ code: "INVALID_CREDENTIALS" }`; 423: `{ code: "ACCOUNT_LOCKED", retryAfterSeconds: number }`

## Task List
### Phase 1: Nền
- [ ] DEMO-11: Module auth dùng chung: băm mật khẩu, phát JWT · be-dev
### Checkpoint: Nền
- [ ] Unit test của module auth xanh
### Phase 2: Đăng nhập
- [ ] DEMO-12: Đăng nhập bằng email và mật khẩu (Sub-task BE DEMO-13, FE DEMO-14) · be-dev, fe-dev (Sub-task) · effort xhigh: kiểm mật khẩu và đặt cookie
- [ ] DEMO-15: Khóa tài khoản 15 phút sau 5 lần nhập sai · be-dev
### Checkpoint: Đăng nhập
- [ ] E2E test của DEMO-12 và DEMO-15 pass trên Development

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Bị dò mật khẩu hàng loạt | High | DEMO-15 khóa tài khoản; API giới hạn số request |

## Open Questions
- Không có.
````

</details>
