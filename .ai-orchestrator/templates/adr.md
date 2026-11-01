<!--
Template for the `adr` artifact in contract/policies.yaml: one architecture decision, saved as docs/adr/NNNN-<slug>.md
with the next free number. Sections follow the ADR template of agent-skills' documentation-and-adrs.
Never delete an old ADR: a changed decision gets a new ADR that supersedes it.
Keep headings in English and write the content in Vietnamese. Delete the guidance comments and the Example section when you are done.
-->

# ADR-NNNN: <Decision title>

> **Epic:** <EPIC-KEY, or "none"> · **Jira:** <link to the Epic or item that raised the decision>

## Status

<!-- Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
An ADR written with the plan of an Epic reads "Proposed with the plan of <EPIC-KEY>; it takes effect when you approve
the plan at gate ②". Nobody changes it to Accepted later: the Epic's state on Jira says whether the plan is approved. -->

## Date

<!-- YYYY-MM-DD -->

## Context

<!-- The problem, and the requirements or constraints that force a decision. -->

## Decision

<!-- What we chose, in one or two sentences. -->

## Alternatives Considered

<!-- One subsection per option: pros, cons, and why it was rejected. -->

### <Option>
- Pros: <...>
- Cons: <...>
- Rejected: <...>

## Consequences

<!-- What becomes easier or harder, and what we must do from now on. -->

## Example

<details>
<summary>Ví dụ: ADR của Epic "Đăng nhập" (DEMO-10)</summary>

````markdown
# ADR-0003: Lưu JWT trong cookie httpOnly

> **Epic:** DEMO-10 · **Jira:** https://example.atlassian.net/browse/DEMO-10

## Status
Proposed with the plan of DEMO-10; it takes effect when you approve the plan at gate ②

## Date
2026-11-03

## Context
Trang web phải gửi token đăng nhập trong mọi request tới `apps/api`. Nếu JavaScript đọc được token thì chỉ một lỗi XSS là đủ để lộ token.

## Decision
API đặt JWT vào cookie `access_token` có `HttpOnly`, `Secure` và `SameSite=Lax`.

## Alternatives Considered
### localStorage
- Pros: dễ làm, không phải chống CSRF.
- Cons: JavaScript đọc được, nên lộ token khi có XSS.
- Rejected: rủi ro bảo mật cao hơn.

## Consequences
- Trình duyệt tự gửi cookie, FE không cầm token.
- Các request làm đổi dữ liệu phải chống CSRF.
````

</details>
