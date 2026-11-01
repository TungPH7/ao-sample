<!--
Template for the `qa-report` artifact in contract/policies.yaml: the QA result of one item, posted by `qa` as a comment
on the Jira item, with links to the CI artifacts. A FAIL sends the item back to in-progress through qa-fail: list the
failing criteria here instead of opening a Bug. A NOT TESTED leaves the item in QA: flag it "Needs you" and stop.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you are done.
-->

# QA report: <KEY> <item title>

## Result

<!-- PASS when every acceptance criterion passes. FAIL when at least one fails. NOT TESTED when none fails but at least
one could not be tested for a reason outside the code: missing data, an outside service, a check that needs a person. -->

PASS | FAIL | NOT TESTED

## Environment

<!-- The QA environment of the item, as .ai-orchestrator/docs/sdlc.md routes it (development, staging or production),
and its URL. -->

## Commit

<!-- The commit or tag that was deployed when you tested, and the PR it came from. -->

## Acceptance Criteria

<!-- One row per criterion, by its AC<n> code. Put what you observed next to the criterion, and add nothing the SPEC does
not ask for. Evidence fits the criterion: a screenshot for the UI, the test name or a recorded result for behaviour.
A criterion without an E2E test is FAIL, not NOT TESTED, because the Story DoD asks for one. For NOT TESTED, write in
Evidence why it could not be tested. -->

| Acceptance criterion | Result | Evidence |
|---|---|---|
| <AC<n>: Given … When … Then …> | PASS / FAIL / NOT TESTED | <screenshot, test name, video or trace; for NOT TESTED, the reason> |

## CI Artifacts

<!-- Links to the CI run and its artifacts: E2E videos, traces, screenshots. -->

## Notes

<!-- Anything else you saw that is outside this item, or "Không có". -->

## Example

<details>
<summary>Ví dụ: báo cáo QA của Story DEMO-12</summary>

````markdown
# QA report: DEMO-12 Đăng nhập bằng email và mật khẩu

## Result
PASS

## Environment
development: https://dev.example.com

## Commit
`3f2a9c1` trên `develop`, từ PR #42.

## Acceptance Criteria
| Acceptance criterion | Result | Evidence |
|---|---|---|
| AC1: Given tài khoản đã kích hoạt, When nhập đúng email và mật khẩu, Then vào trang Đơn hàng | PASS | `login.spec.ts` › AC1 logs in with valid credentials; ảnh `.ai/qa/DEMO-12/ac1-orders.png` |
| AC2: Given mật khẩu sai, When bấm Đăng nhập, Then thấy "Email hoặc mật khẩu không đúng" | PASS | `login.spec.ts` › AC2 rejects a wrong password; ảnh `.ai/qa/DEMO-12/ac2-error.png` |

## CI Artifacts
https://github.com/example/shop/actions/runs/123456 (video, trace)

## Notes
Không có.
````

</details>
