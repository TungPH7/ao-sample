# ADR-0003: Một dạng JSON cho mọi lỗi của API

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2

## Status

Proposed with the plan of SMP-2; it takes effect when you approve the plan at gate ②

## Date

2026-11-02

## Context

`/notes` là những endpoint đầu tiên của `apps/api` có nhận dữ liệu. NFR bảo mật của SMP-2 đòi:

- Mọi lỗi có cùng một dạng JSON.
- Lỗi 400 nêu từng trường sai bằng mã máy đọc được, không lặp lại giá trị đã gửi.
- Lỗi 500 chỉ có một thông báo chung, không có stack trace.
- JSON hỏng trả 400 với thông báo cố định.

Mặc định Nest 12.3.2 không làm được như vậy. Nó trả `{ statusCode, message, error }`, và `message` lấy từ exception. Spike trên `apps/api` cho thấy:

- JSON hỏng trả 400, `message` chứa nguyên câu lỗi của `JSON.parse` kèm một đoạn thân yêu cầu.
- Thân lớn hơn 100 kB trả 413.
- Exception thường trả 500.
- Một filter toàn cục, kể cả khi đăng ký bằng `APP_FILTER` trong `AppModule`, bắt được cả lỗi của body-parser, lỗi 404 của đường dẫn lạ lẫn exception thường.

Dạng lỗi chọn bây giờ sẽ thành hợp đồng của mọi endpoint sau này. Client sẽ dựa vào nó, nên đổi lại về sau là một thay đổi phá vỡ.

## Decision

Mọi lỗi của API có dạng:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed.", "fields": [{ "field": "title", "code": "REQUIRED" }] } }
```

- `code` là mã máy đọc được, viết `UPPER_SNAKE`.
- `message` là một câu tiếng Anh cố định theo `code`, không bao giờ lấy từ exception hay từ yêu cầu.
- `fields` chỉ có khi `code` là `VALIDATION_FAILED`.

Một filter toàn cục, `ApiExceptionFilter`, đăng ký bằng `APP_FILTER` trong `AppModule`, đổi mọi exception sang dạng này. Lỗi 500 được ghi tên và stack vào log bằng `Logger` của Nest, không kèm thân yêu cầu. Bảng mã nằm ở mục API Contract của `docs/specs/SMP-2/plan.md`.

## Alternatives Considered

### Giữ dạng mặc định của Nest, chỉ thay `message`
- Pros: ít code, quen với người dùng Nest.
- Cons: lỗi 400 cần thêm danh sách trường, nên dạng vẫn khác nhau giữa các lỗi; `message` vẫn dễ bị lấy từ exception và lộ dữ liệu.
- Rejected: không đạt "cùng một dạng" và "không lặp lại giá trị".

### Problem Details (RFC 9457, `application/problem+json`)
- Pros: là chuẩn, có sẵn công cụ đọc.
- Cons: có thêm `type`, `title`, `detail`, `instance` mà Epic này không có gì để điền; `Content-Type` riêng; chưa client nào cần nó.
- Rejected: nặng hơn nhu cầu. Muốn chuyển sang sau này thì sẽ là một thay đổi phá vỡ, và đó là cái giá được chấp nhận.

### Mỗi controller tự trả JSON lỗi
- Pros: không cần filter.
- Cons: lỗi của body-parser và lỗi 404 không đi qua controller nào, nên vẫn ra dạng mặc định; dạng lỗi lệch nhau theo từng endpoint.
- Rejected: không phủ được mọi lỗi.

## Consequences

- Endpoint mới chỉ ném `HttpException` hoặc `ValidationFailedException`, không tự viết JSON lỗi.
- Thêm một `code` mới là thay đổi cộng thêm, không phá vỡ. Đổi tên `code` cũ hay bỏ trường thì phá vỡ.
- Vì filter nằm trong `AppModule`, integration test dựng `AppModule` bằng `Test.createTestingModule` có cùng hành vi lỗi như bản chạy thật, không cần bước cấu hình riêng.
- Web trong Epic này không đọc thân lỗi: mọi câu trả lời không phải 2xx đều hiện thông báo chung của SPEC. Mã lỗi phục vụ client khác, test và người đọc log.
- Mọi lỗi 400 không phải `ValidationFailedException` đều thành `INVALID_BODY`. Một Epic sau cần loại lỗi 400 khác thì thêm `code` mới.
