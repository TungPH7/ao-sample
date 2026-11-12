# ADR-0004: Ghim và bỏ ghim bằng `PUT` và `DELETE` trên `/notes/:id/pin`, câu trả lời là cả danh sách đã xếp

> **Epic:** SMP-23 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-23

## Status

Proposed with the plan of SMP-23; it takes effect when you approve the plan at gate ②

## Date

2026-11-11

## Context

SPEC của SMP-23 cho người dùng ghim tối đa 3 ghi chú lên đầu danh sách. Plan phải chốt endpoint, method và tên trường. Các ràng buộc của SPEC:

- Form HTML ở trang khác không được gọi được việc ghim. Yêu cầu ghim phải dùng method mà form không gửi được, như `PUT` hay `DELETE`, hoặc chỉ nhận `Content-Type: application/json` (NFR, Bảo mật).
- API không đọc thân yêu cầu để lấy tiêu đề, nội dung, thời gian hay thứ tự.
- Ghim và bỏ ghim là idempotent: gửi lại cùng yêu cầu cho cùng kết quả.
- `GET /notes` trả danh sách đã xếp, và web không tự sắp lại theo thời gian. Sau khi ghim hay bỏ ghim thành công, thứ tự trên trang phải khớp đúng thứ tự API trả về khi tải lại trang, mà không tải lại trang. Design (S1.11) đòi điều đó cả khi hai ghi chú được ghim gần như cùng lúc.
- Mỗi lần bấm gửi đúng 1 yêu cầu đổi trạng thái ghim, rồi tối đa 1 `GET`.
- Thứ tự theo thứ tự API nhận yêu cầu, kể cả hai lần ghim hay hai lần tạo trong cùng một mili giây. Hai ghi chú tạo cùng mili giây có cùng `createdAt`, nên web không dựng lại được thứ tự từ các trường thời gian.

Ràng buộc của repo: trình duyệt chỉ gọi API qua rewrite của web, và API không bật CORS (ADR-0002); mọi lỗi theo một dạng JSON (ADR-0003); không thêm thư viện npm.

Đây là endpoint công khai đầu tiên đổi trạng thái của một ghi chú đã có. Client sẽ dựa vào nó, và SMP-19 (lưu bền vững) sẽ phải lưu đúng những gì nó định nghĩa, nên đổi về sau là thay đổi phá vỡ.

## Decision

- Ghim là tài nguyên con của ghi chú: `PUT /notes/:id/pin` ghim, `DELETE /notes/:id/pin` bỏ ghim. Không có thân yêu cầu, và API không đọc thân hay `Content-Type` của hai yêu cầu này.
- Cả hai trả `200` với `Cache-Control: no-store`. Thân là cả danh sách, cùng dạng `NoteList` của `GET /notes`, đúng như `GET /notes` trả về ngay sau thay đổi đó.
- `Note` có thêm `pinnedAt: string | null`. Kho giữ thứ tự ghim riêng, theo thứ tự nhận yêu cầu. `pinnedAt` chỉ để đọc, API không dùng nó để xếp.
- Web chuyển tiếp thêm đúng đường `/api/notes/:id/pin` (ADR-0002). Web hiện danh sách API trả về, không sắp lại. Khi có nhiều danh sách tới, web giữ danh sách của yêu cầu được gửi sau cùng.

## Alternatives Considered

### `PATCH /notes/:id` với thân `{ "pinned": true }`
- Pros: một endpoint cho mọi lần sửa ghi chú sau này, cách làm REST quen thuộc.
- Cons: phải đọc và kiểm thân JSON, kiểm `Content-Type` và kiểu của `pinned`, trái yêu cầu không đọc thân. Một endpoint sửa ghi chú cũng mở đường cho sửa tiêu đề và nội dung, vốn nằm ngoài phạm vi.
- Rejected: nhiều thứ phải kiểm hơn trong khi Epic không cần gì từ thân yêu cầu.

### `POST /notes/:id/pin` và `POST /notes/:id/unpin`, chỉ nhận `Content-Type: application/json`
- Pros: giống `POST /notes` của SMP-2.
- Cons: form gửi được `POST`, nên việc chặn form ở trang khác chỉ dựa vào một lần kiểm `Content-Type`; quên kiểm ở một endpoint là có lỗ hổng. `POST` không idempotent theo HTTP, nên client và proxy không biết gửi lại là an toàn. Lại phải có hai đường.
- Rejected: an toàn nhờ code thay vì nhờ chính method.

### Trả về ghi chú vừa đổi, web tự đặt nó vào chỗ mới
- Pros: câu trả lời nhỏ.
- Cons: ghim thì dễ, vì ghi chú lên đầu. Bỏ ghim thì web phải tìm chỗ theo thời gian tạo: SPEC cấm điều này, và nó sai với hai ghi chú tạo cùng mili giây. Web cũng không thấy ghim của người khác, nên thứ tự trên trang có thể khác thứ tự API trả khi tải lại trang.
- Rejected: không đạt yêu cầu về thứ tự.

### Trả về ghi chú hoặc `204`, rồi web gọi lại `GET /notes`
- Pros: dùng lại `listNotes` có sẵn; câu trả lời của yêu cầu ghim nhỏ.
- Cons: mỗi lần bấm tốn hai lượt đi về, và tổng dữ liệu nặng bằng cách đã chọn cộng thêm một yêu cầu. Nếu `GET` hỏng sau khi ghim đã thành, trang không biết hiện gì: ghi chú đã ghim ở API mà trang vẫn hiện như chưa ghim.
- Rejected: chậm hơn, và có một trạng thái lỗi không có cách hiện đúng.

### Thêm số `revision` của kho vào mọi danh sách, để web biết danh sách nào mới hơn
- Pros: đúng cả khi API xử lý hai yêu cầu của một trang theo thứ tự khác thứ tự gửi.
- Cons: thêm một trường vào hợp đồng, và mọi client sau này phải hiểu nó. Số đếm về 0 khi API khởi động lại, nên một trang còn mở sẽ bỏ qua mọi danh sách mới cho tới khi tải lại trang, trừ khi thêm cả mã của tiến trình API.
- Rejected: phức tạp hơn mức cần. Với một người bấm trên một trang, yêu cầu gửi sau gần như luôn được xử lý sau. Rủi ro còn lại ghi ở mục Consequences.

## Consequences

- Form HTML không gửi được `PUT` hay `DELETE`. Một trang ở origin khác muốn gửi chúng bằng `fetch` thì trình duyệt phải hỏi preflight `OPTIONS` trước, và câu trả lời không có `Access-Control-Allow-Origin` vì API không bật CORS. Vì vậy hai endpoint không kiểm `Content-Type`. Nếu sau này API bật CORS cho một origin nào đó, phải xem lại điều này.
- `id` lạ, kể cả sai dạng, trả 404 `NOT_FOUND`. Giới hạn 3 thêm một mã lỗi, `PINNED_NOTES_LIMIT_REACHED` (409); đây là thay đổi cộng thêm theo ADR-0003. Web đọc thân lỗi của đúng trường hợp này để phân biệt nó với các lỗi khác.
- Mỗi câu trả lời của ghim và bỏ ghim nặng bằng một `GET /notes`, tối đa 1000 ghi chú dài tối đa. Nếu một Epic sau phân trang `GET /notes`, câu trả lời của ghim phải đổi theo cùng cách, và đó là thay đổi phá vỡ của ADR này.
- Web bỏ qua một danh sách tới sau nếu yêu cầu của nó được gửi trước yêu cầu của danh sách đang hiện. Nếu API xử lý hai yêu cầu của cùng một trang theo thứ tự khác thứ tự gửi, trang có thể hiện trạng thái cũ hơn API cho tới khi tải lại. Trạng thái ở API và giới hạn 3 thì không bao giờ sai.
- Thêm `pinnedAt` vào `Note` là thay đổi cộng thêm: `POST /notes` và `GET /notes` trả thêm trường này.
- SMP-19 phải lưu thứ tự ghim riêng, không suy ra từ `pinnedAt`.
- Rewrite mới chỉ khớp một đoạn đường dẫn (`:id`), và đích luôn kết thúc bằng `/pin`. API không có đường nào khác kết thúc bằng `/pin`, nên rewrite không mở thêm đường nào khác của API.
- Epic sau cho sửa hay xóa ghi chú nên theo cùng mẫu: method mà form không gửi được, và trả cả danh sách khi thứ tự có thể đổi. Nếu không, Epic đó viết một ADR mới thay cho ADR này.
