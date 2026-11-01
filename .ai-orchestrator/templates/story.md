<!--
Template for the `story` artifact in contract/policies.yaml: the Jira description of a Story, written by `ba` from the plan.
The first line is the Jira summary; the rest is the description. Keep headings in English and write the content in Vietnamese.
The Story moves to `ready` only when every Definition of Ready item is ticked; the items quote contract/work-items.yaml.
Delete the guidance comments and the Example section when you are done.
-->

# <Story title>

> **Epic:** <EPIC-KEY> · **Plan:** <link to docs/specs/<EPIC-KEY>/plan.md>

## User Story

<!-- One sentence: who, what and why ("Là …, tôi muốn … để …"). -->

## Acceptance Criteria

<!-- Each criterion is testable and gets its own E2E test, whose name starts with the criterion code (Story DoD).
Keep the AC<n> codes of the SPEC. -->

- [ ] AC<n>: Given <context>, When <action>, Then <outcome>

## Dependencies

<!-- Jira keys of the items that must be merged into the base branch first, or "Không có". -->

## Design

<!-- The screens of docs/specs/<EPIC-KEY>/design.md that the Story covers, by code (S1, S2), or "Không đổi giao diện". -->

## Sub-tasks

<!-- Only when the Story has both FE and BE work: one Sub-task per side, BE first, each about 5 code files or fewer,
test files not counted. Both commit to the Story's branch, and the PR opens when every Sub-task is done.
Otherwise write "Không có Sub-task" and keep the whole Story within about 5 code files. -->

| Sub-task | Side | Scope |
|---|---|---|
| <KEY> | BE | <what, about N code files> |
| <KEY> | FE | <what, about N code files> |

## Verification

<!-- The commands and the manual check that show the Story works before review. -->

## Definition of Ready

- [ ] Có câu user story
- [ ] Có acceptance criteria dạng Given/When/Then, mỗi tiêu chí kiểm thử được
- [ ] Thuộc Epic có plan đã duyệt
- [ ] Đã xác định item phụ thuộc
- [ ] Vừa cỡ: mỗi Sub-task, hoặc cả Story nếu không có Sub-task, khoảng 5 file code trở xuống, không tính file test
- [ ] Có hợp đồng API trong plan nếu Story có cả FE và BE
- [ ] Có thiết kế màn hình nếu đụng tới giao diện

## Example

<details>
<summary>Ví dụ: Story DEMO-12 của Epic "Đăng nhập"</summary>

````markdown
# Đăng nhập bằng email và mật khẩu

> **Epic:** DEMO-10 · **Plan:** docs/specs/DEMO-10/plan.md

## User Story
Là người dùng, tôi muốn đăng nhập bằng email và mật khẩu để xem đơn hàng của mình.

## Acceptance Criteria
- [ ] AC1: Given tài khoản đã kích hoạt, When nhập đúng email và mật khẩu, Then vào trang Đơn hàng.
- [ ] AC2: Given mật khẩu sai, When bấm Đăng nhập, Then thấy "Email hoặc mật khẩu không đúng".

## Dependencies
DEMO-11 (module auth dùng chung).

## Design
S1, S2 trong docs/specs/DEMO-10/design.md.

## Sub-tasks
| Sub-task | Side | Scope |
|---|---|---|
| DEMO-13 | BE | `POST /auth/login` theo hợp đồng API trong plan, khoảng 3 file code |
| DEMO-14 | FE | Trang `/login` gọi API và hiện lỗi, khoảng 4 file code |

## Verification
`npm test` ở `apps/api` và `apps/web` xanh; E2E `e2e/auth/login.spec.ts` pass.

## Definition of Ready
Đủ 7 mục, `ba` kiểm ngày 2026-11-04.
````

</details>
