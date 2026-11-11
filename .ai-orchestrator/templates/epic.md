<!--
Template for the `epic` artifact in contract/policies.yaml: the Jira description of an Epic, written in the main session
by /ao-intake from its interview with the human (human-loop spec 3.1), then read by `ba` when stage spec starts.
The first line is the Jira summary; the rest is the description. Keep headings in English and write the content in Vietnamese.
Write only what the human said or approved: a point the interview did not settle goes under Open Points, never into
another section as a guess. Delete the guidance comments and the Example section when you are done.
-->

# <Epic title>

> **Intake:** <YYYY-MM-DD> · **Related:** <Jira keys of related Epics, or "Không có">

## Objective

<!-- The problem and why it matters now, in two to four sentences. What "done" looks like for the human. -->

## Users

<!-- Who uses the result, and in what situation. -->

## Scope

<!-- What the Epic covers and what it leaves out, as the human decided in the interview. -->

- **In:** <...>
- **Out:** <...>

## Rough Stories

<!-- The user stories as the interview left them, one line each ("Là …, tôi muốn … để …"). `ba` turns them into the
stories and acceptance criteria of the SPEC; they are not criteria yet. -->

- <...>

## Constraints

<!-- Deadlines, budget, technology, data, outside services, or "Không có". -->

## Open Points

<!-- What the interview did not settle, each with the answer the main session proposed, or "Không có". `ba` writes
these under Open Questions of the SPEC; it asks again nothing the human answered above. -->

## Original Request

<!-- The human's first description, word for word, as typed after /ao-intake. -->

## Example

<details>
<summary>Ví dụ: Epic DEMO-30 tạo bằng /ao-intake</summary>

````markdown
# Hoàn tác khi xóa sản phẩm khỏi giỏ hàng

> **Intake:** 2026-11-12 · **Related:** DEMO-20

## Objective
Khách lỡ tay xóa sản phẩm khỏi giỏ thì phải tìm và thêm lại từ đầu; ở bản thử, 1 trong 5 người đã gặp chuyện này. Xong là khi khách hoàn tác được trong vài giây, không cần tải lại trang.

## Users
Khách mua hàng trên web, cả máy tính và điện thoại.

## Scope
- **In:** hoàn tác một lần xóa; thông báo có nút "Hoàn tác".
- **Out:** hoàn tác nhiều lần xóa liên tiếp; giỏ hàng của khách chưa đăng nhập.

## Rough Stories
- Là khách, tôi muốn hoàn tác lần xóa vừa rồi để không phải tìm lại sản phẩm.

## Constraints
Không có.

## Open Points
- Thời gian cho phép hoàn tác: đề xuất 5 giây.

## Original Request
cho khách hoàn tác khi lỡ xóa sản phẩm khỏi giỏ
````

</details>
