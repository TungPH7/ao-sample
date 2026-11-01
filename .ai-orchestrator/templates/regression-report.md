<!--
Template for the `regression-report` artifact in contract/policies.yaml: the regression report of one release on Staging,
written by `qa` and saved as docs/releases/vX.Y.Z.md on the release branch.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you are done.
-->

# Regression report: <vX.Y.Z>

## Release

<!-- The version, its Fix Version in Jira, the release branch, and the items it contains. -->

## Regression Result

<!-- The full regression suite on Staging: passed and failed counts, the CI run link, and each failure with its Bug key. -->

## Demo and UAT

<!-- Who saw the demo, what you accepted in UAT, and what you asked to change. -->

## Open Bugs

<!-- Bugs still open whose Affects Version includes this release, counted by Severity. -->

| Severity | Open | Keys |
|---|---|---|
| Critical | <n> | <...> |
| High | <n> | <...> |
| Medium | <n> | <...> |
| Low | <n> | <...> |

## Known Issues

<!-- The open Medium and Low Bugs that ship with this release; they also go into the release note. -->

## Exit Check

<!-- The exit condition of the staging-verify stage in contract/stages.yaml. -->

- [ ] Regression PASS
- [ ] Không còn Bug Critical/High mở cho bản này

## Example

<details>
<summary>Ví dụ: báo cáo regression của bản v1.5.0</summary>

````markdown
# Regression report: v1.5.0

## Release
v1.5.0 trên nhánh `release/v1.5.0`, gồm DEMO-11, DEMO-12 và DEMO-15.

## Regression Result
150/150 test pass ở lần chạy cuối (https://github.com/example/shop/actions/runs/123999). Lần chạy đầu có 2 test fail vì DEMO-20; bản sửa đã vào v1.5.0.

## Demo and UAT
Bạn xem demo ngày 2026-11-12 và chấp nhận cả ba item.

## Open Bugs
| Severity | Open | Keys |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | DEMO-21 |
| Low | 0 | |

## Known Issues
- DEMO-21: thông báo khóa tài khoản chưa hiện thời gian chờ còn lại.

## Exit Check
- [x] Regression PASS
- [x] Không còn Bug Critical/High mở cho bản này
````

</details>
