<!--
Template for the `bug` artifact in contract/policies.yaml: the Jira description of a Bug, written by whoever reports it.
A defect found while QA checks an item that is not Done is not a Bug: that item goes back through qa-fail.
The first line is the Jira summary; the rest is the description. Keep headings and field names in English and write the content
in Vietnamese. The Definition of Ready items quote contract/work-items.yaml.
Delete the guidance comments and the Example section when you are done.
-->

# <Bug title>

> **Related:** <key of the Story or Epic this Bug belongs to>

## Steps to Reproduce

<!-- Numbered steps that anyone can follow, with the environment URL and the test account. -->

1. <...>

## Actual Result

## Expected Result

<!-- What should happen, according to the acceptance criteria or the spec. -->

## Fields

<!-- `ba` proposes Affects Version and Severity, and you approve them. Fix Version follows the bug routing table in
.ai-orchestrator/docs/sdlc.md: the oldest version with the bug and the Severity decide it. -->

| Field | Value |
|---|---|
| Found in | Development / Staging / Production |
| Affects Version | <oldest version that has the bug> |
| Severity | Critical / High / Medium / Low, with the reason |
| Fix Version | <the version that gets the fix, and why> |

## Evidence

<!-- Logs, screenshots or a video. No customer data and no secrets. -->

## Definition of Ready

- [ ] Có bước tái hiện, kết quả thực tế và kết quả mong đợi
- [ ] Đã điền Found in, Affects Version, Severity, Fix Version
- [ ] Có bằng chứng (log, ảnh)

## Example

<details>
<summary>Ví dụ: Bug DEMO-20 của Epic "Đăng nhập"</summary>

````markdown
# Tài khoản tạo trước ngày 01/11 luôn bị báo sai mật khẩu

> **Related:** DEMO-12

## Steps to Reproduce
1. Mở https://staging.example.com/login
2. Nhập email của một tài khoản tạo trước ngày 01/11 và đúng mật khẩu
3. Bấm Đăng nhập

## Actual Result
Thấy "Email hoặc mật khẩu không đúng".

## Expected Result
Vào trang Đơn hàng.

## Fields
| Field | Value |
|---|---|
| Found in | Staging |
| Affects Version | v1.5.0 |
| Severity | High: luồng đăng nhập hỏng với mọi tài khoản cũ, không có cách né |
| Fix Version | v1.5.0: bản đang ở Staging, sửa từ `release/v1.5.0`, QA trên Staging |

## Evidence
Log của API lúc 2026-11-10 09:12: `verify: unsupported hash format`.

## Definition of Ready
Đủ 3 mục.
````

</details>
