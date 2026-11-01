<!--
Template for the `spec` artifact in contract/policies.yaml: the SPEC of one Epic, saved as docs/specs/<EPIC-KEY>/spec.md.
Sections follow the spec template of agent-skills' spec-driven-development, so the skill can work on the file directly.
Keep headings and field names in English and write the content in Vietnamese.
Delete the guidance comments and the Example section when you are done.
-->

# Spec: <Epic name>

> **Epic:** <EPIC-KEY> · **Jira:** <link to the Epic> · **Status:** Draft | Approved <YYYY-MM-DD>

## Objective

<!-- What the Epic builds and why, for which users, and what success looks like. List its user stories, each with
acceptance criteria in Given/When/Then form, numbered AC1, AC2… across the whole Epic. The plan turns the stories into
Jira Stories, which keep the numbers, and design.md points to criteria by these codes. When the Epic touches the UI,
`ux` writes the screens in docs/specs/<EPIC-KEY>/design.md next to this file. -->

## Tech Stack

<!-- Only what this Epic adds or changes, with versions. Point to the project README for the rest. -->

## Commands

<!-- Full commands with flags for build, test, lint and dev, when this Epic changes them. -->

## Project Structure

<!-- Where this Epic's code, tests and docs go. -->

## Code Style

<!-- One real snippet of a convention this Epic must follow, when it is not already in CLAUDE.md. -->

## Testing Strategy

<!-- Test levels per concern: unit and integration tests written with TDD for every Story, an E2E test for every
acceptance criterion (Story DoD in .ai-orchestrator/docs/sdlc.md), and where each kind of test lives. -->

## Boundaries

- **Always:** <...>
- **Ask first:** <...>
- **Never:** <...>

## Success Criteria

<!-- Specific, testable conditions that say the Epic is done, on top of the Epic DoD in
.ai-orchestrator/docs/sdlc.md. -->

## Open Questions

<!-- What still needs your decision before gate ① spec-approval. -->

## Example

<details>
<summary>Ví dụ: Epic "Đăng nhập" (DEMO-10)</summary>

````markdown
# Spec: Đăng nhập

> **Epic:** DEMO-10 · **Jira:** https://example.atlassian.net/browse/DEMO-10 · **Status:** Approved 2026-11-02

## Objective
Người dùng đã có tài khoản đăng nhập bằng email và mật khẩu để dùng các trang cần xác thực.
- Story: Là người dùng, tôi muốn đăng nhập bằng email và mật khẩu để xem đơn hàng của mình.
  - AC1: Given tài khoản đã kích hoạt, When nhập đúng email và mật khẩu, Then vào trang Đơn hàng.
  - AC2: Given mật khẩu sai, When bấm Đăng nhập, Then thấy "Email hoặc mật khẩu không đúng".
- Story: Là chủ shop, tôi muốn tài khoản bị khóa 15 phút sau 5 lần nhập sai để chống dò mật khẩu.
  - AC3: Given đã nhập sai 5 lần liên tiếp, When đăng nhập lần thứ 6, Then thấy "Tài khoản tạm khóa 15 phút".

## Tech Stack
Thêm thư viện phát JWT và băm mật khẩu ở `apps/api`; phần còn lại như README.

## Commands
Không đổi so với README.

## Project Structure
Module auth ở `apps/api/src/auth/`, trang đăng nhập ở `apps/web/app/login/`, E2E ở `e2e/auth/`.

## Code Style
Như CLAUDE.md.

## Testing Strategy
Unit và integration test cho service và controller auth; mỗi acceptance criterion có một E2E test.

## Boundaries
- **Always:** băm mật khẩu trước khi lưu; email sai và mật khẩu sai trả về cùng một thông báo.
- **Ask first:** đổi thời hạn của token.
- **Never:** ghi mật khẩu hoặc token vào log.

## Success Criteria
Hai Story trên đạt DoD; security review không còn finding Critical/High.

## Open Questions
- Có cần "Ghi nhớ đăng nhập" không? Đề xuất để sang Epic sau.
````

</details>
