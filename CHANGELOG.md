# Changelog

## [0.1.0] - 2026-11-10

### Added

- Trang Ghi chú ở `/notes`: form tạo ở trên, danh sách ở dưới (SMP-6).
- Tạo ghi chú có tiêu đề (1–100 ký tự) và nội dung không bắt buộc (tối đa 1000 ký tự). Ghi chú mới hiện ngay ở đầu danh sách, không cần tải lại trang. Bấm Lưu hai lần chỉ tạo một ghi chú. Khi lưu lỗi, chữ đã nhập vẫn còn trong form (SMP-7).
- API `POST /notes` và `GET /notes`. Web chuyển `/api/notes` tới API (SMP-6, SMP-7, ADR-0002).
- Form và API dùng chung một bộ quy tắc ghi chú: chuẩn hóa NFC, đếm ký tự theo điểm mã Unicode, bỏ khoảng trắng ở đầu và cuối tiêu đề (SMP-5, ADR-0001).
- Lỗi nhập hiện ngay cạnh ô sai, khi đang gõ hoặc khi rời ô, và mất ngay khi giá trị hợp lệ trở lại (SMP-10).
- Danh sách ghi chú: mới nhất ở đầu, giữ nguyên các lần xuống dòng, thời gian tạo dạng `dd/MM/yyyy HH:mm` theo giờ máy người dùng. Có thông báo khi chưa có ghi chú nào và khi không tải được danh sách (SMP-11).
- Kho giữ tối đa 1000 ghi chú. Khi kho đầy, API trả 409 `NOTES_LIMIT_REACHED` và form hiện lỗi lưu; danh sách vẫn hiện đủ 1000 ghi chú (SMP-18).
- Chạy trên VPS qua deployer của kit: Dockerfile cho `apps/web` và `apps/api` (chạy không cần root), `.ai-orchestrator/deploy.yaml` có smoke test, ba môi trường Development, Staging và Production. Có thể chạy E2E vào URL của môi trường, kèm basic auth (SMP-17).

### Changed

- Trang chủ `/` không còn là trang mẫu của Next.js mà chuyển thẳng tới `/notes` (SMP-6).
- Mọi lỗi của API trả về cùng một dạng JSON, thay cho dạng mặc định của NestJS. Lỗi 400 nêu từng trường sai; lỗi 500 không có stack trace (SMP-4, ADR-0003).
- Gỡ hai workflow giả `.github/workflows/deploy.yml` và `audit.yml`, vì deployer làm thay việc của chúng (SMP-17).
- Cập nhật bản chép kit ai-orchestrator theo kit đã review ở ao-pilot (SMP-16).

### Fixed

Không có.

### Known Issues

Không có Bug nào mở (regression ngày 2026-11-10). Các giới hạn có chủ ý của bản này, theo SPEC của SMP-2:

- Ghi chú chỉ nằm trong bộ nhớ của API, nên mất khi API khởi động lại và sau mỗi lần deploy.
- Production không có đăng nhập hay giới hạn tần suất, nên bất kỳ ai cũng làm đầy kho 1000 ghi chú được. Khi đó không ai tạo được ghi chú mới cho tới khi API khởi động lại, và lần khởi động lại đó xóa hết ghi chú. Epic SMP-19 xử lý việc này.
