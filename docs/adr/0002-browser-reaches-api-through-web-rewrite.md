# ADR-0002: Trình duyệt gọi API qua rewrite của web, cùng origin với trang

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2

## Status

Proposed with the plan of SMP-2; it takes effect when you approve the plan at gate ②

## Date

2026-11-02

## Context

Trang `/notes` lấy danh sách và tạo ghi chú qua API NestJS ở cổng 3001, còn trang chạy ở cổng 3000. Ba yêu cầu buộc **trình duyệt** là bên gửi yêu cầu, không phải máy chủ web:

- Thời gian tạo phải được đổi sang giờ của máy người dùng ngay trong trình duyệt (NFR, mục Dữ liệu).
- Danh sách không được cache ở web, dù `next.config.ts` bật `cacheComponents` (NFR).
- E2E của AC7, AC8, AC10 và AC13 phải điều khiển được câu trả lời của API bằng `page.route` của Playwright, vì SPEC xếp endpoint chỉ dùng cho test vào mục "Ask first". `page.route` chỉ chặn được yêu cầu do trình duyệt gửi.

Trình duyệt có hai đường tới API: gọi thẳng cổng 3001, hoặc gọi một đường dẫn trên chính origin của web và để web chuyển tiếp. NFR cấm mở CORS cho mọi origin, và để plan chọn giữa hai đường.

## Decision

Trình duyệt chỉ gọi `/api/notes` trên origin của web. `next.config.ts` khai báo đúng một rewrite: `/api/notes` tới `${API_URL}/notes`. `API_URL` là biến môi trường phía máy chủ web, mặc định `http://localhost:3001`. API không bật CORS.

## Alternatives Considered

### Trình duyệt gọi thẳng API, API mở CORS cho origin của web
- Pros: không qua trạm trung gian, và trình duyệt thấy thẳng câu trả lời của API.
- Cons:
  - Cần hai biến môi trường: `NEXT_PUBLIC_API_URL`, bị đóng cứng vào bundle lúc build, và origin của web cho API.
  - Mỗi `POST` JSON kéo theo một yêu cầu preflight `OPTIONS`.
  - Câu trả lời giả của E2E phải tự thêm `Access-Control-Allow-Origin` và phải để `OPTIONS` đi qua.
  - Mở trang bằng `127.0.0.1` thay vì `localhost` thì CORS chặn.
  - Khi lên môi trường công khai, API cũng phải công khai.
- Rejected: nhiều chỗ cấu hình hơn và dễ sai hơn, mà không được gì thêm trong phạm vi chạy của Epic.

### Route Handler của Next.js làm proxy (`app/api/notes/route.ts`)
- Pros: kiểm soát hoàn toàn: đổi header, ghi log, tự đặt thời gian chờ.
- Cons: thêm một file code phải tự chuyển tiếp thân yêu cầu, mã trạng thái và lỗi mạng, và tự viết test cho chúng.
- Rejected: rewrite làm được cùng việc bằng một mục cấu hình.

### Server Component hay Server Action gọi API
- Pros: không lộ API cho trình duyệt.
- Cons: `page.route` không chặn được yêu cầu từ máy chủ web; muốn đổi giờ ở trình duyệt thì vẫn phải gửi dữ liệu xuống; còn phải tránh cache của `cacheComponents`.
- Rejected: hỏng cách kiểm E2E mà SPEC đòi.

## Consequences

- Đã thử bằng `next dev` 16.4.3 và một API giả (spike, không commit): rewrite giữ nguyên mã trạng thái (200, 201, 400, 500), thân JSON và header `Cache-Control: no-store`. Khi API tắt, web trả 500 cho trình duyệt và ghi `Failed to proxy` vào log, không kèm thân yêu cầu.
- API không có CORS. Không trang nào ở origin khác đọc được câu trả lời của nó qua trình duyệt.
- Rủi ro đã chấp nhận: khi `npm run dev` chạy, API nghe ở mọi giao diện mạng (`app.listen(port)` không truyền host, `apps/api/src/main.ts`) và không kiểm header `Host`. Máy cùng mạng gọi được cổng 3001 nếu tường lửa cho qua, và một trang web dùng DNS rebinding đọc và tạo được ghi chú, nên dòng trên chỉ đúng khi không có DNS rebinding. Người duyệt chấp nhận rủi ro này cho Pilot 1 (2026-11-03), vì dữ liệu là ghi chú mẫu trong bộ nhớ và ứng dụng chỉ chạy ở máy dev và CI. Cách chặn (API nghe ở loopback, từ chối `Host` ngoài danh sách, web tự kiểm `Host` cho `/api/notes`) là một item riêng sau Pilot 1.
- Web chỉ mở đúng `/api/notes`. Endpoint mới của API muốn trình duyệt dùng được thì phải thêm rewrite, và việc đó là có chủ ý.
- E2E chặn yêu cầu bằng `page.route('**/api/notes', …)`, không cần preflight hay header CORS. AC9 vẫn gửi thẳng tới `http://localhost:3001/notes`.
- Với bản build production, giá trị `API_URL` đọc lúc `next build` được ghi vào bản build. Đổi `API_URL` thì phải build lại. Deploy của Pilot là giả lập, nên điều này chưa ảnh hưởng.
- Khi lên môi trường công khai, chỉ web cần công khai, API có thể nằm trong mạng riêng.
- Giới hạn 100 kB, kiểm tra `Content-Type` và mọi quy tắc vẫn do API áp dụng. Rewrite không kiểm tra gì.
