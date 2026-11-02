# Implementation Plan: Ghi chú: tạo và xem danh sách

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2 · **Spec:** [spec.md](spec.md) · **Tasks:** tracked in Jira under SMP-2

## Overview

Epic thêm một trang Ghi chú ở `/notes` (màn hình S1 của [design.md](design.md)) và hai endpoint `GET /notes`, `POST /notes` cho API. Thứ tự làm:

1. Ba việc nền, làm song song được: dạng lỗi chung của API, quy tắc ghi chú dùng chung cho form và API, và khung trang `/notes` cùng đường từ web tới API.
2. Story Tạo ghi chú: API đầy đủ (lưu, đọc, kiểm tra) và form lưu được.
3. Hai Story chạy song song: lỗi nhập hiện ngay cạnh ô, và danh sách đầy đủ (thời gian tạo, trạng thái trống, lỗi tải).

User story "Tạo ghi chú" của SPEC (AC1–AC9) được tách thành hai Story, vì một Story chín tiêu chí quá lớn cho một lượt làm. Mã tiêu chí giữ nguyên.

## Architecture Decisions

1. **Trình duyệt gọi `/api/notes` trên origin của web, `next.config.ts` rewrite tới API** ([ADR-0002](../../adr/0002-browser-reaches-api-through-web-rewrite.md)).
   - Rewrite đúng một đường dẫn: `/api/notes` tới `${API_URL ?? 'http://localhost:3001'}/notes`.
   - API không bật CORS.
   - Trình duyệt là bên gửi yêu cầu, nên E2E chặn được bằng `page.route` mà không cần endpoint chỉ dùng cho test.
   - Đã thử: rewrite giữ nguyên mã trạng thái, thân và `Cache-Control`. API tắt thì web trả 500.
2. **Kiểu và quy tắc của ghi chú nằm ở một file, `apps/api/src/notes/notes.shared.ts`; web import qua alias `@api/notes-shared`** ([ADR-0001](../../adr/0001-share-note-rules-from-api-source.md)).
   - Đây là "cùng một hàm" mà SPEC đòi, và cũng là nơi giữ kiểu của hợp đồng API, nên web và API lệch nhau thì `npm run typecheck` báo lỗi.
   - File không import gì, không decorator, không API riêng của Node.js hay trình duyệt.
   - Đã thử: `tsc` của web, Vitest và `next build` (Turbopack) đều đọc được file qua alias.
3. **Mọi lỗi của API có dạng `{ "error": { "code", "message", "fields"? } }`** ([ADR-0003](../../adr/0003-one-json-error-shape-for-the-api.md)).
   - Một `ApiExceptionFilter` toàn cục, đăng ký bằng `APP_FILTER` trong `AppModule`, đổi mọi exception sang dạng này. Bảng mã ở mục API Contract.
   - `message` là câu cố định theo `code`, không bao giờ lấy từ exception. Câu lỗi của body-parser chứa một đoạn thân yêu cầu (đã thử), nên không lọt ra ngoài.
   - Integration test dựng `AppModule` nên có cùng filter, không cần bước cấu hình riêng.
4. **API tự kiểm tra `Content-Type` và kiểu của thân yêu cầu.**
   - Nest giữ hai parser mặc định (JSON và urlencoded), giới hạn 100 kB.
   - Đã thử: thân `application/x-www-form-urlencoded` hay `text/plain` vẫn tới controller, và thân JSON là mảng cũng vậy. Vì thế controller trả 415 khi `req.is('application/json')` sai, và trả 400 `INVALID_BODY` khi thân không phải object, rồi mới kiểm tra quy tắc.
   - Service chỉ đọc `title` và `content`, và tự dựng object `Note` mới, không spread thân yêu cầu. Vì vậy `id`, `createdAt` hay `__proto__` gửi lên đều bị bỏ qua.
5. **Kho trong bộ nhớ là một mảng theo thứ tự nhận yêu cầu.**
   - `list()` trả bản sao đảo ngược, nên mới nhất lên trước, kể cả hai ghi chú cùng mili giây.
   - `id` sinh bằng `crypto.randomUUID()`; `createdAt` là `new Date().toISOString()` lúc API nhận yêu cầu.
   - Kho là provider singleton trong `NotesModule`, chạy trong một tiến trình API duy nhất.
6. **Trang `/notes` là khung tĩnh, danh sách tải ở trình duyệt.**
   - `notes/page.tsx` là Server Component không lấy dữ liệu: chỉ có `main`, h1 và `<NotesView />`.
   - Form và danh sách là Client Component. Danh sách gọi `GET /api/notes` một lần sau khi trang hydrate. Không `use cache`, không fetch ở máy chủ web, nên `cacheComponents` không cache gì; thời gian tạo được đổi giờ ngay ở trình duyệt.
   - Effect tải danh sách hủy yêu cầu bằng `AbortController` khi cleanup. Ở `next dev`, React Strict Mode chạy effect hai lần, nên có thể thấy hai `GET` (cái đầu bị hủy). Bản build production chỉ gửi một.
   - Không thêm thư viện lấy dữ liệu (SWR, TanStack Query): SPEC không cho thêm thư viện.
7. **Trạng thái danh sách ở web** (`notes-view.tsx`): `loading`, `ready` (có `notes`) hoặc `error`.

   | Lưu thành công khi danh sách đang | Web làm gì |
   |---|---|
   | `ready` | Chèn ghi chú vào đầu danh sách, không gọi `GET` |
   | `loading` | Giữ ghi chú lại. Khi `GET` trả về thì đặt nó lên đầu, bỏ trùng theo `id` |
   | `error` | Gọi lại `GET` một lần và vẫn hiện lỗi tải trong lúc chờ. Tải được thì hiện danh sách, không được thì giữ lỗi tải. Đây là đề xuất trong Open Questions của design.md mà NFR của SPEC đã nhận |

8. **Web chờ API tối đa 10 s.**
   - Dùng `AbortController` cùng `setTimeout` của global, không dùng `AbortSignal.timeout`. Nhờ vậy test điều khiển được thời gian bằng `vi.useFakeTimers()`, như NFR đòi.
   - Mọi câu trả lời không phải 2xx, lỗi mạng, quá giờ hay thân không đọc được đều là lỗi. Web không đọc thân lỗi. API trả 400 trong khi form thấy hợp lệ thì cũng hiện lỗi lưu [S1.8], đúng đề xuất của design.md.
9. **Làm đúng những gì design.md đã duyệt vẽ ra.** Các mục design.md ghi "design chưa có" thì không làm: dòng "Đã lưu ghi chú." cho trình đọc màn hình, nút "Thử lại", dấu đánh dấu ô bắt buộc, bộ đếm ký tự. Các đề xuất có trong hành vi của design.md thì làm như design.md tả.
10. **Cách kiểm E2E** (`e2e/notes/`; Playwright chạy song song trên một tiến trình API dùng chung):
    - Mỗi test tạo tiêu đề riêng, như `AC1 ${crypto.randomUUID().slice(0, 8)}`. Test không giả định danh sách trống và không đếm tổng số ghi chú.
    - Ghi chú dựng sẵn cho test (AC11, AC12) tạo bằng `request.post('http://localhost:3001/notes', { data })`, như `e2e/smoke.spec.ts`.
    - Câu trả lời cần kiểm soát được (AC7, AC8, AC10, AC13) giả lập bằng `page.route('**/api/notes', handler)`. Handler chỉ chặn đúng method cần giả lập; method khác thì gọi `route.continue()`. Mẫu `**/api/notes` không khớp trang `/notes`.
      - AC7: giữ `POST` lại tới khi bấm Lưu lần hai xong, rồi `route.continue()`.
      - AC8: `route.abort('failed')`, và một ca `route.fulfill({ status: 500 })`.
      - AC10: `route.fulfill({ json: { data: [] } })`.
      - AC13: `route.fulfill({ status: 500 })`, và một ca `route.abort('failed')`.
    - AC9 gửi thẳng tới `http://localhost:3001/notes` bằng `request`.
    - AC11 đặt `test.use({ timezoneId: 'Asia/Ho_Chi_Minh' })` và tính giờ mong đợi từ `createdAt` mà API trả về.
    - Tên test bắt đầu bằng mã tiêu chí. `be-dev` viết E2E của AC9; `fe-dev` viết E2E của các tiêu chí còn lại.

## API Contract

Hợp đồng của Story 4 (Tạo ghi chú), Story duy nhất có cả FE và BE. Story 5 và 6 chỉ dùng lại hợp đồng này.

### Kiểu dùng chung: `apps/api/src/notes/notes.shared.ts`

Web import file này bằng `import { … } from '@api/notes-shared'`; API import bằng `./notes.shared.js`.

```ts
export const TITLE_MAX_CHARS = 100;
export const CONTENT_MAX_CHARS = 1000;

export interface Note {
  id: string;        // crypto.randomUUID()
  title: string;     // đã chuẩn hóa: NFC, xuống dòng là \n, bỏ khoảng trắng đầu và cuối; 1–100 ký tự
  content: string;   // đã chuẩn hóa: NFC, xuống dòng là \n; 0–1000 ký tự; "" khi không gửi
  createdAt: string; // ISO 8601 UTC có mili giây, như "2026-11-02T07:40:00.000Z"
}
export interface CreateNoteInput { title: string; content?: string }
export interface NoteList { data: Note[] }

export type NoteField = 'title' | 'content';
export type NoteFieldErrorCode = 'REQUIRED' | 'TOO_LONG' | 'INVALID_TYPE';
export interface NoteFieldError { field: NoteField; code: NoteFieldErrorCode }

export function normalizeTitle(value: string): string;   // NFC, rồi \r\n và \r thành \n, rồi trim()
export function normalizeContent(value: string): string; // NFC, rồi \r\n và \r thành \n
export function countChars(value: string): number;       // Array.from(value.normalize('NFC')).length
export function checkTitle(value: string): 'REQUIRED' | 'TOO_LONG' | null; // nhận giá trị thô của ô, tự chuẩn hóa
export function checkContent(value: string): 'TOO_LONG' | null;
export function checkNote(input: { title?: unknown; content?: unknown }):
  | { ok: true; value: { title: string; content: string } } // giá trị đã chuẩn hóa, đúng như API lưu
  | { ok: false; errors: NoteFieldError[] };                // mỗi trường tối đa một lỗi, title trước content
```

Quy tắc của `checkNote`, theo mục Rules của SPEC:

| Trường | Giá trị nhận | Lỗi |
|---|---|---|
| `title` | không có (`undefined`) | `REQUIRED` |
| `title` | không phải chuỗi (số, `null`, mảng, object, boolean) | `INVALID_TYPE` |
| `title` | chuỗi, sau chuẩn hóa còn 0 ký tự | `REQUIRED` |
| `title` | chuỗi, sau chuẩn hóa hơn 100 ký tự | `TOO_LONG` |
| `content` | không có (`undefined`) | không lỗi, lưu `""` |
| `content` | không phải chuỗi (kể cả `null`) | `INVALID_TYPE` |
| `content` | chuỗi, sau chuẩn hóa hơn 1000 ký tự | `TOO_LONG` |

### `GET /notes`

Trình duyệt gọi `GET /api/notes` trên web.

- Không nhận tham số. Trả mọi ghi chú, không phân trang: SPEC để phân trang ngoài phạm vi. Danh sách nằm trong `data`, nên sau này thêm phân trang chỉ là thêm trường.
- `200` với header `Cache-Control: no-store`:

```json
{ "data": [{ "id": "6f1c…", "title": "Mua sữa", "content": "2 hộp", "createdAt": "2026-11-02T07:40:00.000Z" }] }
```

- `data` xếp mới nhất trước, theo thứ tự API nhận yêu cầu. Kho trống thì `{ "data": [] }`.

### `POST /notes`

Trình duyệt gọi `POST /api/notes` trên web.

- **Request:** header `Content-Type: application/json` (cho phép kèm `; charset=utf-8`); thân là `CreateNoteInput`. API chỉ đọc `title` và `content` và bỏ qua mọi trường khác.
- **`201`:** thân là `Note` vừa lưu, mang giá trị đã chuẩn hóa.

```json
{ "id": "6f1c…", "title": "Mua sữa", "content": "2 hộp", "createdAt": "2026-11-02T07:40:00.000Z" }
```

- **Lỗi**, theo thứ tự API kiểm tra. Không lỗi nào tạo ghi chú.

| Thứ tự | Trường hợp | Mã trạng thái | `error.code` |
|---|---|---|---|
| 1 | Thân lớn hơn 100 kB (body-parser) | 413 | `PAYLOAD_TOO_LARGE` |
| 2 | JSON hỏng, kể cả thân chỉ là `null` (body-parser) | 400 | `INVALID_BODY` |
| 3 | `Content-Type` không phải `application/json`, hoặc thiếu | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 4 | Thân JSON không phải object, như mảng | 400 | `INVALID_BODY` |
| 5 | Sai quy tắc theo `checkNote` | 400 | `VALIDATION_FAILED`, kèm `fields` |

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed.", "fields": [{ "field": "title", "code": "TOO_LONG" }, { "field": "content", "code": "INVALID_TYPE" }] } }
```

- Thân `{}` (`Content-Type` JSON, không có trường nào) trả `VALIDATION_FAILED` với `[{ "field": "title", "code": "REQUIRED" }]`.
- `POST` không idempotent và không nhận `Idempotency-Key`: gửi lại là tạo thêm một ghi chú (NFR, mục Gửi lại).

### Dạng lỗi chung: `apps/api/src/common/api-error.ts`

```ts
export type ApiErrorCode =
  | 'VALIDATION_FAILED' | 'INVALID_BODY' | 'NOT_FOUND' | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE' | 'REQUEST_FAILED' | 'INTERNAL_ERROR';
export interface FieldError { field: string; code: string } // NoteFieldError khớp kiểu này
export interface ApiErrorBody { error: { code: ApiErrorCode; message: string; fields?: FieldError[] } }
export class ValidationFailedException extends BadRequestException {
  constructor(readonly fields: FieldError[]) { super(); }
}
```

`ApiExceptionFilter` đổi exception như sau. `message` luôn đúng nguyên văn cột cuối.

| Exception nhận được | Mã trạng thái | `code` | `message` |
|---|---|---|---|
| `ValidationFailedException` | 400 | `VALIDATION_FAILED` (kèm `fields`) | `Request validation failed.` |
| `HttpException` 400 khác, kể cả JSON hỏng | 400 | `INVALID_BODY` | `Request body must be a JSON object.` |
| `HttpException` 404, kể cả đường dẫn lạ | 404 | `NOT_FOUND` | `Resource not found.` |
| `HttpException` 413 | 413 | `PAYLOAD_TOO_LARGE` | `Request body is too large.` |
| `HttpException` 415 | 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type must be application/json.` |
| `HttpException` 4xx khác | giữ nguyên | `REQUEST_FAILED` | `Request failed.` |
| Mọi thứ khác, kể cả `HttpException` 5xx | 500 | `INTERNAL_ERROR` | `Internal server error.` |

Với dòng cuối, filter ghi tên và stack của exception bằng `Logger` của Nest, không ghi thân yêu cầu. Câu trả lời lỗi đi kèm `Content-Type: application/json`.

### Lớp gọi API của web: `apps/web/src/app/notes/notes-api.ts`

```ts
export class NotesRequestError extends Error {}
export function listNotes(signal?: AbortSignal): Promise<Note[]>;        // GET /api/notes, trả về data
export function createNote(input: CreateNoteInput): Promise<Note>;       // POST /api/notes, Content-Type: application/json
```

- Cả hai dùng đường dẫn tương đối `/api/notes`, không đọc biến môi trường.
- Mỗi yêu cầu có thời gian chờ 10 s (quyết định 8).
- Lỗi được ném ra dưới dạng `NotesRequestError`: quá giờ, lỗi mạng, mã không phải 2xx, hay thân không đọc được. Khi chính `signal` của bên gọi hủy, như component unmount, thì ném lại `AbortError` để bên gọi bỏ qua.

## Task List

Mỗi dòng có ô đánh dấu là một item Jira. Các gạch đầu dòng con bên dưới là chi tiết để `ba` viết item. Đếm file không tính file test.

### Phase 1: Nền

Ba Task không phụ thuộc nhau, làm song song được.

- [ ] Task 1: Dạng lỗi chung của API · be-dev · effort xhigh: bảo mật. Lỗi trả về không được lặp lại thân yêu cầu hay lộ stack, và dạng lỗi là hợp đồng của mọi endpoint sau này (ADR-0003), sai thì sửa về sau là thay đổi phá vỡ.
  - Mục tiêu: mọi lỗi của API có dạng và mã như bảng "Dạng lỗi chung" ở mục API Contract.
  - Phạm vi, 3 file code: `apps/api/src/common/api-error.ts` (kiểu, `ValidationFailedException`); `apps/api/src/common/api-exception.filter.ts`; `apps/api/src/app.module.ts` (đăng ký `APP_FILTER`).
  - Test:
    - Unit `api-exception.filter.spec.ts` cho từng dòng của bảng. Có một ca `BadRequestException` mà message chứa chuỗi bí mật: chuỗi đó không có trong câu trả lời. Có một ca `Error` thường: trả 500 và log có stack.
    - Integration `apps/api/test/app.e2e-spec.ts`: `GET /nope` trả 404 `NOT_FOUND`; `POST /health` với JSON hỏng trả 400 `INVALID_BODY` và thân trả về không chứa đoạn đã gửi; thân 110 kB trả 413 `PAYLOAD_TOO_LARGE`; `GET /health` vẫn 200.
  - Không đổi giao diện. Phụ thuộc: không có.
- [ ] Task 2: Quy tắc ghi chú dùng chung cho form và API · be-dev
  - Mục tiêu: `notes.shared.ts` đúng như mục "Kiểu dùng chung" của API Contract (ADR-0001), là nền của AC3, AC4, AC5 và AC9.
  - Phạm vi, 1 file code: `apps/api/src/notes/notes.shared.ts`. File không import gì.
  - Test unit `notes.shared.spec.ts`, viết theo TDD, gồm các ca của Testing Strategy trong SPEC:
    - biên 0, 1, 100, 101 và 1000, 1001 ký tự;
    - chữ có dấu gõ ở dạng NFD ("e" + U+0301 tính 1 ký tự và trả về dạng NFC);
    - tiêu đề chỉ có khoảng trắng hay NBSP thì `REQUIRED`, U+200B thì không bị bỏ;
    - 👍🏽 tính 2, 👨‍👩‍👧 tính 5, 🇻🇳 tính 2;
    - `\r\n` và `\r` tính 1 ký tự và trả về `\n`;
    - đủ các ca `INVALID_TYPE` của bảng quy tắc;
    - thứ tự lỗi: title trước content.
  - Không đổi giao diện. Phụ thuộc: không có.
- [ ] Task 3: Khung trang Ghi chú · fe-dev
  - Mục tiêu: `/` chuyển tới `/notes`; `/notes` có khung trang, h1 và hai phần có h2; web chuyển `/api/notes` tới API (ADR-0002).
  - Phạm vi, 4 file code và 2 file cấu hình/kiểu:
    - `apps/web/src/app/layout.tsx`: `lang="vi"`, `metadata.title` là "Ghi chú".
    - `apps/web/src/app/page.tsx`: `redirect('/notes')` của `next/navigation`.
    - `apps/web/src/app/notes/page.tsx`: Server Component với `main`, cột giữa rộng tối đa 640 px, lề 16/24 px, h1 "Ghi chú" và `<NotesView />`.
    - `apps/web/src/app/notes/notes-view.tsx`: hai `section`. Phần đầu có h2 "Tạo ghi chú" (`id="create-note-heading"`), phần sau có h2 "Danh sách ghi chú" (`id="notes-list-heading"`), cách nhau 32 px.
    - `apps/web/src/app/globals.css`: thêm màu chữ phụ, màu lỗi, màu nhấn, màu viền và màu vòng focus, cho cả chế độ sáng và tối. Chữ đạt tương phản 4.5:1, vòng focus 3:1.
    - `apps/web/next.config.ts`: `rewrites()` đúng một mục, `/api/notes` tới `${process.env.API_URL ?? 'http://localhost:3001'}/notes`.
  - Test: sửa `page.test.tsx` (giả lập `next/navigation`, kiểm tra `redirect('/notes')`); thêm `notes/page.test.tsx` (h1 "Ghi chú", hai h2). `e2e/smoke.spec.ts` vẫn pass: mở `/` thì tới `/notes` và thấy h1.
  - Design: S1.1, S1.2, S1.3 (chỉ h2), S1.10. Phụ thuộc: không có.

### Checkpoint: Nền

- [ ] `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run test:e2e -w api`, `npm run build` và `npm run test:e2e` (smoke) đều pass.
- [ ] Chạy `npm run dev` rồi `curl -i http://localhost:3000/api/notes` thì nhận 404 với `{"error":{"code":"NOT_FOUND",…}}`. Đây là bằng chứng rewrite và filter cùng chạy.

### Phase 2: Tạo ghi chú

- [ ] Story 4: Tạo ghi chú (AC1, AC2, AC7, AC8, AC9) · be-dev, fe-dev (Sub-task)
  - Hợp đồng: `GET /notes` và `POST /notes` ở mục API Contract. Phụ thuộc: Task 1, 2, 3.
  - Design: S1.3 (form), S1.4, S1.6, S1.8, S1.9, S1.11 (trạng thái có ghi chú, bản cơ bản), S1.12 và S1.14 (bản cơ bản).
  - **Sub-task BE**, 5 file code, làm trước:
    - `apps/api/src/notes/notes.store.ts`: kho, quyết định 5.
    - `apps/api/src/notes/notes.service.ts`: kiểm tra object, `checkNote`, dựng `Note`; ném `BadRequestException` hay `ValidationFailedException`.
    - `apps/api/src/notes/notes.controller.ts`: `GET` có `Cache-Control: no-store`; `POST` trả 201, kiểm tra 415 trước.
    - `apps/api/src/notes/notes.module.ts`.
    - `apps/api/src/app.module.ts`: import `NotesModule`.
    - Test:
      - Unit cho kho (thứ tự, bản sao) và service.
      - Integration `apps/api/test/notes.e2e-spec.ts`: tạo hợp lệ; mỗi dòng của bảng lỗi `POST`; mỗi ca `INVALID_TYPE`; trường thừa `id`, `createdAt`, `__proto__` bị bỏ qua; gửi NFD và `\r\n` thì nhận lại NFC và `\n`; `GET` mới nhất trước và có `no-store`; nạp 1000 ghi chú dài tối đa rồi `GET` trả về dưới 1 s (NFR hiệu năng).
      - E2E `e2e/notes/create-note-api.spec.ts`: AC9, kiểm tra cả việc không ghi chú nào được lưu.
  - **Sub-task FE**, 4 file code và 1 dòng cấu hình:
    - `apps/web/tsconfig.json`: alias `"@api/notes-shared": ["../api/src/notes/notes.shared.ts"]`.
    - `apps/web/src/app/notes/notes-api.ts`: như mục API Contract.
    - `apps/web/src/app/notes/notes-view.tsx`: Client Component, tải danh sách, trạng thái và cách gộp theo quyết định 6 và 7. Trong Story này, `loading` và `error` chưa hiện gì ở phần danh sách; Story 6 thêm phần đó.
    - `apps/web/src/app/notes/note-form.tsx`, theo S1.3–S1.9:
      - `form` có `noValidate` và `aria-labelledby="create-note-heading"`.
      - Hai ô có `label`; ô Tiêu đề có `aria-required="true"` và `autocomplete="off"`; ô Nội dung cao tối thiểu 4 dòng, cỡ chữ ít nhất 16 px.
      - Nút "Lưu" là `type="submit"`, cao ít nhất 44 px.
      - Lúc đang lưu: hai ô `readOnly`; nút có `aria-disabled="true"`, `aria-busy="true"` và vòng xoay. Chặn gửi đôi (AC7) bằng một `useRef` đặt ngay khi submit, không chỉ bằng state, vì hai lần bấm có thể tới trước lần vẽ lại.
      - Lưu được: xóa hai ô, đưa con trỏ về ô Tiêu đề, gọi `onCreated(note)`.
      - Lưu không được: hiện [S1.8] "Không lưu được ghi chú. Vui lòng thử lại." với `role="alert"` ngay trên nút, giữ nguyên dữ liệu và con trỏ ở nút. [S1.8] ẩn đi khi gửi lại.
      - Trong Story này form chưa kiểm tra ô; Story 5 thêm phần đó. Giá trị sai thì API trả 400 và form hiện lỗi lưu.
    - `apps/web/src/app/notes/note-list.tsx`: `ul` với mỗi `li` có h3 tiêu đề và nội dung, nội dung trống thì không vẽ. Story 6 hoàn thiện.
    - Test:
      - Integration với Testing Library, `fetch` được giả lập.
      - Mỗi lần lưu đúng một `POST`; mở trang đúng một `GET`; lưu xong không gọi `GET` khi danh sách đang `ready`.
      - Lưu trong lúc danh sách đang tải thì không trùng, không mất ghi chú.
      - Quá 10 s thì hiện lỗi lưu, dùng `vi.useFakeTimers()`.
      - Bấm Lưu hai lần thì chỉ một `POST`.
      - E2E `e2e/notes/create-note.spec.ts`: AC1, AC2, AC7, AC8.
  - Kiểm tay: đo một lần bằng DevTools từ lúc bấm Lưu tới lúc ghi chú hiện ở đầu danh sách, phải ≤ 1 s (NFR).

### Checkpoint: Tạo ghi chú

- [ ] E2E AC1, AC2, AC7, AC8, AC9 và smoke pass trên môi trường Development.
- [ ] Gửi thẳng tới API một thân form-urlencoded thì nhận 415, gửi một mảng thì nhận 400 `INVALID_BODY`, và không ghi chú nào được tạo.

### Phase 3: Lỗi nhập và danh sách

Story 5 và Story 6 cùng phụ thuộc Story 4, và không sửa chung file nào, nên làm song song được.

- [ ] Story 5: Báo lỗi nhập ngay cạnh ô (AC3, AC4, AC5, AC6) · fe-dev
  - Không có Sub-task. Phạm vi, 1–2 file code: `apps/web/src/app/notes/note-form.tsx`. Nếu tách logic lỗi của ô ra hook thì thêm `apps/web/src/app/notes/use-field-errors.ts`.
  - Kiểm tra bằng `checkTitle` và `checkContent` của `@api/notes-shared`. Không đặt `maxlength`; lỗi đổi ngay trong lần vẽ của phím gõ, không debounce.
  - Khi nào lỗi của một ô hiện, đổi hay mất:

    | Lúc | Ô Tiêu đề | Ô Nội dung |
    |---|---|---|
    | Gõ (`change`) | Quá 100 ký tự thì hiện "Tiêu đề tối đa 100 ký tự". Hợp lệ thì xóa lỗi. Trống thì chỉ giữ "Vui lòng nhập tiêu đề" nếu lỗi đó đang hiện; chưa hiện thì không hiện | Quá 1000 ký tự thì hiện "Nội dung tối đa 1000 ký tự", hợp lệ thì xóa lỗi |
    | Rời ô (`blur`) | Trống hoặc chỉ khoảng trắng thì hiện "Vui lòng nhập tiêu đề" | Không làm gì |
    | Bấm Lưu hay Enter ở ô Tiêu đề | Trống thì hiện "Vui lòng nhập tiêu đề", quá dài thì hiện "Tiêu đề tối đa 100 ký tự" | Quá dài thì hiện "Nội dung tối đa 1000 ký tự" |

    Bấm Lưu mà có ô sai thì không gửi yêu cầu nào, và con trỏ chuyển vào ô sai đầu tiên theo thứ tự Tiêu đề, Nội dung.

  - Vùng lỗi [S1.5] và [S1.7]:
    - luôn cao 20 px, kể cả khi không có lỗi;
    - có `id` và `aria-live="polite"`;
    - biểu tượng lỗi `aria-hidden`.
  - Ô có lỗi:
    - có `aria-invalid="true"` và `aria-describedby` trỏ tới vùng lỗi, nên mô tả truy cập đúng bằng nguyên văn thông báo;
    - hết lỗi thì bỏ cả hai thuộc tính.
  - Test:
    - Unit và integration của form: các biên 100/101 và 1000/1001, kể cả chữ có dấu; từng dòng của bảng trên; lỗi hiện ngay khi ô dài 1001 ký tự.
    - E2E `e2e/notes/note-form-errors.spec.ts`: AC3, AC4, AC5, AC6, kiểm tra bằng `toHaveAccessibleDescription` như ví dụ trong SPEC.
  - Design: S1.4, S1.5, S1.6, S1.7, S1.9. Phụ thuộc: Story 4.
- [ ] Story 6: Xem danh sách ghi chú (AC10, AC11, AC12, AC13) · fe-dev
  - Không có Sub-task. Phạm vi, 3 file code:
    - `apps/web/src/app/notes/note-list.tsx`, theo S1.11–S1.14:
      - mục cách nhau bằng đường kẻ 1 px;
      - h3 chữ đậm vừa, `overflow-wrap: anywhere`;
      - `<time dateTime={createdAt}>`: ở desktop cùng hàng bên phải tiêu đề và không xuống dòng, ở mobile nằm dưới tiêu đề;
      - nội dung `white-space: pre-wrap`, không vẽ khi trống.
    - `apps/web/src/app/notes/format-created-at.ts`: ghép `dd/MM/yyyy HH:mm` từ `getDate`, `getMonth`, `getFullYear`, `getHours`, `getMinutes` theo giờ của máy. Không dùng `toLocaleString` hay `Intl.DateTimeFormat`.
    - `apps/web/src/app/notes/notes-view.tsx`, theo S1.11 và S1.15:
      - `loading`: ba hàng khung xương, có `aria-busy="true"`.
      - Danh sách trống: "Chưa có ghi chú nào." với `role="status"`.
      - `error`: "Không tải được danh sách ghi chú. Vui lòng thử lại." với `role="alert"` và biểu tượng lỗi.
      - Lưu thành công khi đang `error` thì tải lại, theo quyết định 7.
  - Tiêu đề và nội dung chỉ vào trang dưới dạng chữ của React. Không `dangerouslySetInnerHTML`, không biến chữ thành link.
  - Test:
    - Unit `format-created-at.test.ts`: số một chữ số được thêm 0, nửa đêm là 00:00, giờ 24.
    - Integration của `notes-view`: đủ bốn trạng thái; quá 10 s thì hiện lỗi tải; lưu khi đang lỗi tải thì gọi lại `GET` đúng một lần.
    - E2E `e2e/notes/list-notes.spec.ts`: AC10, AC11, AC12, AC13. Với AC12, `page.on('dialog')` làm test fail, và trong mục đó không có thẻ `b` nào.
  - Kiểm tay trước khi vào review: 1000 ghi chú hiện đủ trong ≤ 2 s với `npm run build` rồi `next start` (NFR). Nạp dữ liệu bằng: `node --input-type=module -e "for (let i = 0; i < 1000; i++) await fetch('http://localhost:3001/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'N' + i + ' ' + 'x'.repeat(90), content: 'y'.repeat(1000) }) })"`.
  - Design: S1.11, S1.12, S1.13, S1.14, S1.15. Phụ thuộc: Story 4.

### Checkpoint: Hoàn tất

- [ ] E2E AC1–AC13 và smoke đều pass trên môi trường Development.
- [ ] Mọi thông báo lỗi của mục Rules hiện đúng nguyên văn, đúng chỗ, và được gắn với ô của nó.
- [ ] Đã đo tay ba chỉ số hiệu năng của NFR và ghi kết quả vào PR của Story 4 và Story 6.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Sửa `notes.shared.ts` cho API làm hỏng web mà test của API không thấy | Medium | `npm run typecheck`, `npm run build` và `npm run test:coverage` ở gốc chạy cho cả hai workspace trong CI. File không import gì (ADR-0001). Mọi PR sửa file này chạy test của cả hai app |
| Form và API đếm ký tự khác nhau | Low | Cùng một hàm (ADR-0001). Lỡ khác thì API trả 400, web hiện lỗi lưu và giữ dữ liệu, không tạo ghi chú sai |
| E2E chập chờn vì chạy song song trên một kho dùng chung | Medium | Mỗi test có tiêu đề riêng, không đếm tổng, so vị trí tương đối. AC10 và AC13 giả lập câu trả lời (quyết định 10) |
| Thêm một `package-lock.json` trong `apps/web` làm đổi thư mục gốc của Turbopack, alias hỏng | Low | Đặt `turbopack.root` về gốc repo (ADR-0001). `npm run build` trong CI bắt được ngay |
| `API_URL` bị ghi vào bản build production lúc `next build` | Low | Ghi trong ADR-0002. Deploy của Pilot là giả lập. Đổi API thì build lại |
| Ở `next dev`, Strict Mode gửi hai `GET` khi mở trang | Low | Effect hủy yêu cầu cũ khi cleanup. Số yêu cầu của NFR được kiểm ở integration test, không đếm ở E2E |
| Lỗi 400 của body-parser lộ đoạn thân yêu cầu nếu filter để lọt `message` | High | Task 1 có effort xhigh; filter không bao giờ đọc `message` của exception; test có chuỗi bí mật |
| Mạng đứt sau khi API đã lưu, người dùng bấm Lưu lại và có hai ghi chú giống nhau | Low | SPEC chấp nhận rủi ro này (NFR, mục Gửi lại). Form chặn gửi đôi trong lúc chờ (AC7) |

## Open Questions

Không có.
