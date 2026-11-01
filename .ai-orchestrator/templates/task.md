<!--
Template for the `task` artifact in contract/policies.yaml: the Jira description of a Task, written by `ba`.
A Task is technical work with no result the end user can see. Work that changes the UI or a public API is a Story.
The first line is the Jira summary; the rest is the description. Keep headings in English and write the content in Vietnamese.
The Definition of Ready items quote contract/work-items.yaml. Delete the guidance comments and the Example section when you are done.
-->

# <Task title>

> **Epic:** <EPIC-KEY, or "none"> · **Plan:** <link to the plan, or "approved directly by you">

## Goal

<!-- What the Task achieves and why it is needed. Shared groundwork for several Stories, such as the auth module or the
schema of an Epic, is a Task that comes before them. -->

## Technical Checklist

<!-- Specific steps or conditions that can each be checked. -->

- [ ] <...>

## Dependencies

<!-- Jira keys of the items that must be merged first, or "Không có". -->

## Verification

<!-- The commands that show the Task is done; the Task DoD also needs the regression suite to pass. -->

## Definition of Ready

- [ ] Có mục tiêu và checklist kỹ thuật kiểm tra được
- [ ] Thuộc Epic có plan đã duyệt, hoặc được bạn duyệt trực tiếp

## Example

<details>
<summary>Ví dụ: Task DEMO-11 của Epic "Đăng nhập"</summary>

````markdown
# Module auth dùng chung: băm mật khẩu, phát JWT

> **Epic:** DEMO-10 · **Plan:** docs/specs/DEMO-10/plan.md

## Goal
Phần nền cho mọi Story của Epic "Đăng nhập": băm và kiểm mật khẩu, phát và kiểm JWT. Người dùng chưa thấy gì, nên đây là Task.

## Technical Checklist
- [ ] `PasswordService.hash` và `PasswordService.verify`
- [ ] `TokenService.sign` và `TokenService.verify`, thời hạn token đọc từ biến môi trường
- [ ] Unit test cho cả hai service

## Dependencies
Không có.

## Verification
Unit test của `apps/api` xanh; bộ regression pass.

## Definition of Ready
Đủ 2 mục, plan của DEMO-10 đã duyệt.
````

</details>
