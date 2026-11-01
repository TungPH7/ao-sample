<!--
Template for the `pull-request` artifact in contract/policies.yaml: the description of the PR of one Story, Task or Bug,
handing the work from the dev agent to `reviewer`, `security` and `qa`.
The first line is the PR title: the commit format `type(scope): subject`, then the Jira key.
A PR is written in English; the Definition of Done items quote contract/work-items.yaml and stay as they are.
Delete the guidance comments and the Example section when you are done.
-->

# <type(scope): subject> (<KEY>)

## Jira

<!-- Key and link of the item. A fix after qa-fail is a new PR with the same key: say which round it is. -->

## What Changed

<!-- What the change does and why, one line per Sub-task when there are several. Link the plan section it implements. -->

## How It Was Tested

<!-- The commands you ran and their results, and any manual check, with screenshots for UI changes. -->

## Acceptance Criteria Coverage

<!-- One row per acceptance criterion of the Story, per checklist item of the Task, or for the reproduction of the Bug. -->

| Acceptance criterion | Test |
|---|---|
| <Given … When … Then …> | <test file › test name> |

## Risks

<!-- What could break, migrations, feature flags, and how to roll back; "None" if there are none. -->

## Definition of Done

<!-- Tick what is true at review time. `qa` and `human` tick the rest after the deploy to the QA environment. -->

- [ ] PR đã merge vào đúng nhánh gốc, mọi check CI xanh
- [ ] Không còn finding Critical/High chưa xử lý
- [ ] Hành vi mới hoặc thay đổi được phủ bởi unit và integration test viết theo TDD
- [ ] Báo cáo QA PASS trên đúng môi trường QA
- [ ] Đã cập nhật tài liệu, và ADR nếu có thay đổi kiến trúc
- [ ] Bạn đã chấp nhận

Story only:

- [ ] E2E test cho từng acceptance criterion đều pass

Task only:

- [ ] Bộ regression pass

Bug only:

- [ ] Có test tái hiện lỗi (fail trước khi sửa, pass sau khi sửa), được đưa vào bộ regression

## Example

<details>
<summary>Example: the PR of Story DEMO-12</summary>

````markdown
# feat(auth): add email and password login (DEMO-12)

## Jira
[DEMO-12](https://example.atlassian.net/browse/DEMO-12): Đăng nhập bằng email và mật khẩu. First round.

## What Changed
- DEMO-13 (BE): `POST /auth/login` checks the password and sets the `access_token` cookie, as in the plan's API contract.
- DEMO-14 (FE): the `/login` page calls the API and shows the error message on 401.

## How It Was Tested
Unit and integration tests of `apps/api` and `apps/web`: pass. E2E `e2e/auth/login.spec.ts`: pass on a local stack.

## Acceptance Criteria Coverage
| Acceptance criterion | Test |
|---|---|
| Given an active account, When the right email and password are entered, Then the Orders page opens | `e2e/auth/login.spec.ts` › logs in with valid credentials |
| Given a wrong password, When Log in is pressed, Then "Email hoặc mật khẩu không đúng" is shown | `e2e/auth/login.spec.ts` › rejects a wrong password |

## Risks
None: a new endpoint and a new page, no migration.

## Definition of Done
- [x] Hành vi mới hoặc thay đổi được phủ bởi unit và integration test viết theo TDD
- [x] Đã cập nhật tài liệu, và ADR nếu có thay đổi kiến trúc
- [x] E2E test cho từng acceptance criterion đều pass
````

</details>
