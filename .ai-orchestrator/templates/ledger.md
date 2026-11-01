<!--
Template for the `ledger` artifact in contract/policies.yaml: the progress notes of the agent working on an item, kept at
.ai/ledger/<KEY>.md on the local machine and never committed. Update it after every step, so that a new session, for
example after a usage limit, picks up where the last one stopped.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you create the file.
-->

# Ledger: <KEY> <item title>

> **Agent:** <role> · **Branch:** <branch> · **Updated:** <YYYY-MM-DD HH:MM>

## Current Step

<!-- The stage (contract/stages.yaml) and the state of the item, and what you are doing right now. -->

## Done

<!-- Finished steps, newest last, with their commit hashes. -->

- [x] <...>

## Next

<!-- The next steps in order; a new session starts with the first one. -->

- [ ] <...>

## Decisions

<!-- Decisions taken while working, and why, so a new session does not decide them again. -->

## Blockers

<!-- What stops the work, and whether the item is flagged "Needs you", or "Không có". -->

## Example

<details>
<summary>Ví dụ: ledger của Sub-task DEMO-13</summary>

````markdown
# Ledger: DEMO-13 BE: API đăng nhập

> **Agent:** be-dev · **Branch:** `feature/DEMO-12-login` · **Updated:** 2026-11-05 16:40

## Current Step
Giai đoạn `build`, Sub-task ở `in-progress`: đang viết test cho tài khoản bị khóa.

## Done
- [x] Đăng nhập đúng mật khẩu: test đỏ rồi xanh (`a1b2c3d`)
- [x] Trả 401 khi sai mật khẩu (`d4e5f6a`)

## Next
- [ ] Trả 423 khi tài khoản bị khóa, theo hợp đồng API trong plan
- [ ] Chuyển Sub-task sang done khi đã commit

## Decisions
- Chuyển email về chữ thường trước khi tìm tài khoản.

## Blockers
Không có.
````

</details>
