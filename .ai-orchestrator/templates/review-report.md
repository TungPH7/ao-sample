<!--
Template for the `review-report` artifact in contract/policies.yaml: a review posted on the PR. It follows the five axes and
the review checklist of agent-skills' code-review-and-quality. `reviewer` covers every axis; `security` posts its own
review with this template and goes deep on the Security axis.
Both roles post through the same GitHub App, so the Role line says which one wrote the report: merge-gate needs a report
of each role on the PR's newest commit.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you are done.
-->

# Review: <PR title> (<KEY>)

Role: <reviewer | security>

<!-- A security review of only the changes since its last full report (dev-workflow spec 2.6) adds, under Role, the line
Scope: changes since <short SHA of the commit of that report>
Every other review covers the whole PR and has no Scope line. -->

## Context

<!-- The spec or plan section the change implements, and the behavior it is meant to change. -->

- [ ] I understand what this change does and why
- [ ] A Task's PR does not change the UI or a public API; if it does, the Task must become a Story

## Findings

<!-- Most important first: correctness and security, then structure, then the rest. Severity:
Critical: blocks merge (security hole, data loss, broken feature). High: must be fixed before merge.
Medium: should be fixed; may wait for a follow-up item. Low: nit or suggestion.
These map to the skill's labels Critical, required (no prefix), Optional/Consider, and Nit/FYI.
The review stage passes only when no Critical or High finding is open. -->

| Severity | Axis | Where | Finding | Suggested fix |
|---|---|---|---|---|
| Critical / High / Medium / Low | <axis> | <file:line> | <...> | <...> |

## Correctness

- [ ] Change matches spec/task requirements
- [ ] Edge cases handled
- [ ] Error paths handled
- [ ] Tests cover the change adequately

## Readability

- [ ] Names are clear and consistent
- [ ] Logic is straightforward
- [ ] No unnecessary complexity

## Architecture

- [ ] Follows existing patterns
- [ ] No unnecessary coupling or dependencies
- [ ] Appropriate abstraction level
- [ ] Refactors reduce complexity rather than relocate it
- [ ] No feature logic in shared modules; file stays within a healthy size

## Security

- [ ] No secrets in code
- [ ] Input validated at boundaries
- [ ] No injection vulnerabilities
- [ ] Auth checks in place
- [ ] External data sources treated as untrusted

## Performance

- [ ] No N+1 patterns
- [ ] No unbounded operations
- [ ] Pagination on list endpoints

## Verification

- [ ] Tests pass
- [ ] Build succeeds
- [ ] Manual verification done (if applicable)

## Verdict

- [ ] **Approve**: ready for your approval at gate ③ merge-approval
- [ ] **Request changes**: the item goes back to in-progress through request-changes

## Example

<details>
<summary>Ví dụ: review PR của Story DEMO-12</summary>

````markdown
# Review: feat(auth): add email and password login (DEMO-12)

Role: reviewer

## Context
- [x] Thay đổi thêm `POST /auth/login` và trang `/login`, theo plan của DEMO-10.
- [x] Đây là Story, không phải Task.

## Findings
| Severity | Axis | Where | Finding | Suggested fix |
|---|---|---|---|---|
| High | Correctness | `apps/api/src/auth/auth.controller.ts:31` | Body thiếu `email` thì API trả 500 | Validate body, trả 400 |
| Low | Readability | `apps/web/app/login/page.tsx:12` | Tên biến `res2` khó hiểu | Đổi thành `loginResponse` |

## Correctness, Readability, Architecture, Security, Performance, Verification
Đã kiểm hết các mục; ngoài hai finding trên thì đạt.

## Verdict
- [x] **Request changes**: sửa finding High rồi review lại.
````

</details>

<details>
<summary>Ví dụ: security chỉ review phần mới của PR đó</summary>

````markdown
# Review: feat(auth): add email and password login (DEMO-12)

Role: security
Scope: changes since 0f1e2d3

## Context
- [x] Phần mới từ `0f1e2d3`: body của `POST /auth/login` được validate, 18 dòng. Báo cáo đầy đủ trên `0f1e2d3` là review ngày 2026-11-02.

## Findings
Không có finding.

## Verdict
- [x] **Approve**: ready for your approval at gate ③ merge-approval
````

</details>
