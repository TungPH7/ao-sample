<!--
Template for the `release-notes` artifact in contract/policies.yaml: the notes of one release, written by `devops` and `ba`.
They go to three places: CHANGELOG.md, as an entry `## [X.Y.Z] - YYYY-MM-DD` with Added, Changed, Fixed and Known Issues
as `###` sections (the changelog format of agent-skills' documentation-and-adrs); the description of the Fix Version in
Jira, which carries the Goal; and Google Drive, which gets the Customer Summary.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you are done.
-->

# Release notes: <vX.Y.Z> (<YYYY-MM-DD>)

## Goal

<!-- What this release is for, as its Fix Version says: a forecast, not a promise. -->

## Added

<!-- New features, one line each, with the Jira key. -->

## Changed

<!-- Changes to existing behavior, with the Jira key, or "Không có". -->

## Fixed

<!-- Bug fixes, with the Bug key, or "Không có". -->

## Known Issues

<!-- Open Bugs that ship with this release, taken from the regression report, or "Không có". -->

## Customer Summary

<!-- A few plain sentences for customers: what is new and what changed for them, without Jira keys or internal terms. -->

## Example

<details>
<summary>Ví dụ: release note của bản v1.5.0</summary>

````markdown
# Release notes: v1.5.0 (2026-11-14)

## Goal
Khách đăng nhập được bằng email và mật khẩu.

## Added
- Đăng nhập bằng email và mật khẩu (DEMO-12).
- Khóa tài khoản 15 phút sau 5 lần nhập sai mật khẩu (DEMO-15).

## Changed
Không có.

## Fixed
- Trang Đơn hàng tải chậm khi có hơn 100 đơn (DEMO-18).

## Known Issues
- Thông báo khóa tài khoản chưa hiện thời gian chờ còn lại (DEMO-21).

## Customer Summary
Từ bản này, bạn đăng nhập được bằng email và mật khẩu. Để bảo vệ tài khoản, sau 5 lần nhập sai mật khẩu, tài khoản sẽ tạm khóa 15 phút. Trang Đơn hàng cũng tải nhanh hơn.
````

</details>
