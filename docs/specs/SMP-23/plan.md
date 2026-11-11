# Implementation Plan: Ghim ghi chú lên đầu danh sách

> **Epic:** SMP-23 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-23 · **Spec:** [spec.md](spec.md) · **Tasks:** tracked in Jira under SMP-23

## Overview

Epic thêm trạng thái ghim cho ghi chú. API có thêm hai endpoint, `PUT /notes/:id/pin` và `DELETE /notes/:id/pin`, web có thêm một rewrite. Trên màn hình S1 của [design.md](design.md), mỗi ghi chú có nút Ghim hoặc Bỏ ghim, dấu Đã ghim, dòng nhắc và lỗi riêng của nó (khối S1.11–S1.20).

Plan giữ một Story như SPEC: "Ghim và bỏ ghim" (AC1–AC11). Story chia hai Sub-task trên cùng một nhánh, BE làm trước rồi tới FE. Plan không có Task nền: theo quy ước của work items, phần kỹ thuật thuộc về chính Story, và chỉ phần nền dùng chung cho nhiều Story mới tách thành Task. Mỗi Sub-task khoảng 5 file code: BE có 6 file, nhưng 3 file trong đó chỉ thêm vài dòng; FE có 5 file code và 1 mục cấu hình.

## Architecture Decisions

1. **Ghim là tài nguyên con của ghi chú: `PUT /notes/:id/pin` ghim, `DELETE /notes/:id/pin` bỏ ghim. Cả hai trả về cả danh sách đã xếp, cùng dạng với `GET /notes`** ([ADR-0004](../../adr/0004-pin-with-put-and-delete-answering-the-sorted-list.md)).
   - Form HTML không gửi được `PUT` hay `DELETE`. Một trang ở origin khác muốn gửi chúng bằng `fetch` thì trình duyệt phải hỏi preflight trước, và API không bật CORS (ADR-0002). Vì vậy hai endpoint không kiểm `Content-Type` và không đọc thân yêu cầu.
   - Theo HTTP, cả hai method đều idempotent, khớp mục Rules: ghim một ghi chú đã ghim, hay bỏ ghim một ghi chú chưa ghim, đều trả 200 và không đổi gì.
   - Câu trả lời mang cả danh sách, nên web hiện đúng thứ tự API vừa xếp mà không tự sắp lại (NFR, mục Dữ liệu). Web cũng không gửi thêm `GET` sau một lần thành công. Số yêu cầu mỗi lần bấm: đúng 1 yêu cầu ghim hay bỏ ghim, thêm đúng 1 `GET` khi API trả 409 (NFR, Hiệu năng).
   - Mỗi câu trả lời nặng bằng một `GET`, tối đa 1000 ghi chú dài tối đa. NFR đặt cùng một ngưỡng cho cả ba yêu cầu.
2. **`Note` có thêm trường `pinnedAt: string | null`, và hằng số `MAX_PINNED_NOTES = 3`. Cả hai nằm trong `notes.shared.ts`** (ADR-0001).
   - `pinnedAt` là lúc API nhận yêu cầu ghim, dạng ISO 8601 UTC có mili giây, và là `null` khi chưa ghim. Ghim lại sau khi bỏ ghim thì có `pinnedAt` mới. Ghim một ghi chú đã ghim thì giữ `pinnedAt` cũ.
   - Thêm trường là thay đổi cộng thêm: `GET /notes` và `POST /notes` trả thêm `pinnedAt`, và ghi chú mới có `pinnedAt: null`.
   - Hàm `isPinned` trong `notes.shared.ts` coi một ghi chú là đã ghim khi `pinnedAt` là chuỗi. Nhờ vậy câu trả lời giả cũ thiếu trường này vẫn là chưa ghim.
3. **Kho giữ thứ tự ghim riêng, không xếp theo `pinnedAt`.**
   - `NotesStore` có thêm danh sách `id` đã ghim, theo thứ tự API nhận yêu cầu ghim, tối đa 3 phần tử. Nhờ vậy hai lần ghim trong cùng mili giây vẫn đúng thứ tự (Rules 1).
   - `list()` trả các ghi chú đã ghim trước, ghim gần nhất đứng đầu; rồi tới các ghi chú chưa ghim, mới nhất đứng đầu, theo thứ tự thêm vào kho như SMP-2. Bỏ ghim thì ghi chú tự về đúng chỗ theo thứ tự tạo (Rules 3); ghim lại thì nó lên đầu (Rules 4).
   - `pin(id, at)` làm mọi việc trong một hàm đồng bộ, không có `await`: kiểm `id`, kiểm ghi chú đã ghim chưa, kiểm giới hạn, rồi ghim. Node chạy một luồng, nên hai yêu cầu cùng lúc không chen được vào giữa, và không bao giờ có ghi chú ghim thứ tư (NFR, Bảo mật).
   - Thứ tự kiểm của `pin(id, at)`: không có `id` thì 404; ghi chú đã ghim thì 200 và không đổi gì; đã có 3 ghi chú ghim thì 409; còn lại thì ghim. Vì vậy ghim lại một ghi chú đã ghim vẫn thành công khi đã đủ 3.
   - Kho tìm ghi chú theo `id` bằng `Map` hoặc bằng cách duyệt mảng, không bằng object thường: `id` như `__proto__` hay `constructor` phải ra 404.
   - Kho không sửa object `Note` nó đã đưa ra ngoài. Ghim và bỏ ghim thay object đó bằng một object mới.
4. **Mã lỗi mới `PINNED_NOTES_LIMIT_REACHED`, mã trạng thái 409** (ADR-0003; thêm mã là thay đổi cộng thêm).
   - `api-error.ts` có thêm `PinnedNotesLimitReachedException extends ConflictException`. Filter đổi nó sang 409 với `message` cố định `The limit of pinned notes is reached.`.
   - Với `id` lạ, service ném `NotFoundException` của Nest, và filter đã đổi nó sang 404 `NOT_FOUND`.
5. **Web chuyển tiếp thêm đúng một đường: `/api/notes/:id/pin` tới `${API_URL}/notes/:id/pin`.** ADR-0002 viết: "Endpoint mới của API muốn trình duyệt dùng được thì phải thêm rewrite, và việc đó là có chủ ý".
   - `:id` chỉ khớp một đoạn của đường dẫn; không dùng `:path*`. Đích luôn kết thúc bằng `/pin`, và API không có đường nào khác kết thúc bằng `/pin`, nên rewrite này không mở thêm đường nào khác của API.
   - `/api/notes/x` và `/api/health` vẫn là 404 của web.
6. **Web đọc thân lỗi trong đúng một trường hợp: 409 của yêu cầu ghim.** Điều này sửa quyết định 8 của plan SMP-2.
   - `notes-api.ts` ném `PinnedNotesLimitError` khi câu trả lời là 409 và `error.code` là `PINNED_NOTES_LIMIT_REACHED`. Mọi lỗi khác vẫn là `NotesRequestError` (AC5, AC7), kể cả 404, 409 mà thân không đọc được, quá 10 s và lỗi mạng.
   - Mỗi yêu cầu chờ tối đa 10 s, như SMP-2. Sau một lần 409, `GET` tải lại danh sách có 10 s của riêng nó.
7. **Trạng thái danh sách ở web** (`notes-view.tsx`), mở rộng quyết định 6 và 7 của SMP-2:
   - Mỗi yêu cầu trả về danh sách (`GET`, `PUT`, `DELETE`) lấy một số thứ tự tăng dần lúc được gửi. Danh sách tới chỉ được hiện khi số của nó lớn hơn số của danh sách đang hiện; danh sách cũ hơn bị bỏ qua. Lỗi của một `GET` cũng theo luật này: nó chỉ thay danh sách bằng lỗi tải khi số của nó lớn hơn số đang hiện. Nhờ vậy, khi hai ghi chú được ghim gần như cùng lúc, câu trả lời cũ hơn mà tới sau không đè lên câu trả lời mới hơn (S1.11).
   - Bỏ qua một danh sách không có nghĩa là bỏ qua ghi chú của yêu cầu đó: nút của nó vẫn hết pending, vùng S1.20 vẫn đọc câu thông báo, và focus vẫn được trả về.
   - Ghi chú trang này vừa tạo được giữ lại cho tới khi một danh sách có nó được hiện. Danh sách nào thiếu nó, vì API xếp danh sách đó trước khi tạo nó, thì nó được chèn vào đầu nhóm chưa ghim, mới nhất trước. Đây chính là `unlisted` của SMP-2, nay áp cho mọi danh sách, không chỉ `GET` đầu tiên.
   - Tạo xong khi danh sách đang `ready` thì chèn ghi chú vào đầu nhóm chưa ghim, ngay dưới các ghi chú đã ghim, và không gọi `GET` (AC3). Đây là quy tắc chỗ đứng của Rules 5, không phải sắp lại theo thời gian.
   - Số ghi chú đã ghim được đếm trên danh sách đang hiện. Khi đủ `MAX_PINNED_NOTES`, nút Ghim của mọi ghi chú chưa ghim khóa ngay trong lần vẽ đó (NFR), kể cả ghi chú vừa tạo.
8. **Trạng thái riêng của từng ghi chú** được giữ theo `id`, ngoài dữ liệu danh sách, nên vẫn còn khi danh sách được thay:
   - Pending: một `Set` trong `useRef`, đặt ngay khi bấm, trước lần vẽ lại, như cách form của SMP-2 chặn gửi đôi (AC7 của SMP-2). Bấm khi nút đang pending hay đang khóa thì không gửi gì (AC4, AC8).
   - Lỗi S1.19: là lỗi `pin` hay `unpin` tùy việc vừa làm. Lỗi mất khi bấm lại nút đó, lúc yêu cầu được gửi, và không mất khi danh sách được thay.
   - Dòng nhắc S1.18: trạng thái hiện hay ẩn nằm trong `pin-button.tsx` và theo đúng S1.18. Sau một lần 409, view bảo nút của ghi chú vừa bấm mở dòng nhắc như sau một lần bấm, và vùng S1.20 đọc câu nhắc. Cả hai chỉ xảy ra khi nút đó bị khóa theo danh sách vừa tải. Nếu danh sách vừa tải có ít hơn 3 ghi chú ghim, vì có người vừa bỏ ghim, thì nút mở, không có dòng nhắc và không có thông báo: S1.18 chỉ có ở nút bị khóa.
9. **Focus sau khi ghi chú đổi chỗ.** Khi thứ tự đổi, React có thể di chuyển `li` trong DOM, và nút trong đó có thể mất focus.
   - Khi câu trả lời của ghi chú X tới, nếu focus đang ở nút của X hoặc không ở đâu (`document.body`), thì sau lần vẽ (`useLayoutEffect`) web gọi `focus()` cho nút của X, không đặt `preventScroll` (S1.17).
   - Trường hợp `document.body` có lý do: Safari không focus nút khi bấm chuột.
   - Focus đang ở chỗ khác, như ô Tiêu đề hay nút của ghi chú khác, thì web để yên.
   - Sau một lần 409, nếu tải lại danh sách không được, khối S1.15 nhận focus với `tabindex="-1"`.
10. **Vùng thông báo S1.20** là một phần tử `role="status"` ẩn khỏi mắt (`sr-only`), anh em của `ul` và được vẽ cùng danh sách. Mỗi lần có thông báo, web xóa chữ rồi đặt câu mới ở một tick sau (`setTimeout`), để cùng một câu xuất hiện hai lần liên tiếp vẫn được đọc.
11. **Khi ẩn, dòng nhắc S1.18 dùng thuộc tính `hidden`.**
    - Mắt không thấy nó và nó không chiếm chỗ. Ở chế độ duyệt, trình đọc màn hình không đọc lặp nó ở từng ghi chú chưa ghim, có thể tới 997 lần.
    - Nó vẫn là mô tả của nút, vì `aria-describedby` trỏ thẳng tới nó, và cách tính tên truy cập (accname) vẫn lấy chữ của phần tử ẩn được trỏ thẳng tới.
    - E2E AC8 kiểm bằng `toHaveAccessibleDescription`. Nếu Chromium không cho ra mô tả đó, dùng lớp `sr-only` thay cho `hidden` và ghi lý do trong PR.
12. **Cách kiểm E2E** (`e2e/notes-pin/`). Playwright chạy song song trên một API dùng chung, và trạng thái ghim là chung cho cả kho.
    - `pin-real-notes.spec.ts` chứa AC1–AC7 và AC11, mọi test ghim ghi chú thật. Đầu file có `test.describe.configure({ mode: 'default' })`, nên các test trong file chạy lần lượt trong một worker. Không dùng `serial`, vì `serial` bỏ qua mọi test sau một test fail. AC11 nằm trong file này vì trong lúc chạy nó giữ tới 3 chỗ ghim, và nếu chạy song song thì nút Ghim của AC1–AC7 sẽ bị khóa.
    - `pin-limit-faked.spec.ts` chứa AC8, AC9 và AC10. Các test này giả lập câu trả lời bằng `page.route` và không ghim gì thật, nên chạy song song được.
    - `pin-helpers.ts` chứa các hàm dùng chung: `uniqueTitle`, `createNote`, `pinNote`, `unpinNote`, `itemWithTitle`, như ví dụ trong mục Code Style của SPEC.
    - Mỗi test tự tạo ghi chú của nó qua `request.post('/api/notes', …)`, với tiêu đề `AC<n> <8 ký tự của uuid>`, và tìm ghi chú theo tiêu đề. Không test nào đếm tổng số ghi chú.
    - Ghim và bỏ ghim trong phần Given, và lúc dọn dẹp, đều gửi qua web: `request.put('/api/notes/<id>/pin')` và `request.delete(…)`, như AC9 của SMP-2. Nhờ vậy test chạy được trên môi trường. Test ghim gì thì bỏ ghim đúng những ghi chú đó trong `finally`, kể cả khi test fail (Code Style của SPEC).
    - Trên trang, ghi chú đã ghim nhận ra bằng chữ "Đã ghim" trong `li` của nó.
    - Giả lập: mẫu `page.route('**/api/notes/*/pin', …)` không khớp `/api/notes`, và mẫu `**/api/notes` của SMP-2 không khớp đường ghim.
      - AC4: giữ `PUT` lại cho tới khi bấm xong lần hai bằng `click({ force: true })`, như AC7 của SMP-2, rồi gọi `route.continue()`. Kiểm có đúng 1 `PUT`. Một ca nữa làm như vậy với `DELETE`.
      - AC5: `route.abort('failed')` cho `PUT`, và một ca `route.fulfill({ status: 500 })`. AC7 làm như vậy cho `DELETE`, sau khi đã ghim thật ghi chú đó.
      - AC8, AC9: `GET` trả một danh sách giả có 3 ghi chú ghim. Ở AC9, `DELETE` trả một danh sách giả có 2.
      - AC10: `GET` đầu tiên trả 2 ghi chú ghim. `PUT` trả 409 với thân đúng dạng của ADR-0003, và `GET` thứ hai trả 3 ghi chú ghim. Kiểm có đúng 1 `PUT` và 2 `GET`.
    - AC2: ghim A rồi B qua `request`, rồi mở trang trong `browser.newContext()` để giả một trình duyệt khác. Kiểm vị trí tương đối: B rồi A ở đầu danh sách, có dấu; D đứng trước C, không có dấu.
    - AC11: tạo 4 ghi chú, ghim lần lượt từng cái cho tới khi API trả 409. Sau đó kiểm `GET` có đúng 3 ghi chú ghim, và ghi chú bị từ chối vẫn chưa ghim. Cách này đúng dù trước đó đã có ghi chú của người khác được ghim.
    - Tên test bắt đầu bằng mã tiêu chí của SMP-23. `fe-dev` viết cả `pin-helpers.ts`, E2E của mọi tiêu chí AC1–AC11, và sửa E2E của SMP-2 theo mục Changes to SMP-2 của SPEC. Lý do: mọi E2E, kể cả AC11, đi qua đường `/api/notes/:id/pin` của web, mà rewrite của đường đó do Sub-task FE thêm (quyết định 5). `be-dev` không viết E2E: ở API, AC11 đã được integration test của Sub-task BE kiểm, với 409 ở ghi chú thứ tư.

## API Contract

Hợp đồng của Story "Ghim và bỏ ghim", Story duy nhất của Epic. Mọi thứ của SMP-2 giữ nguyên, trừ những chỗ nêu dưới đây.

### Kiểu dùng chung: `apps/api/src/notes/notes.shared.ts`

Chỉ thêm, không đổi gì đã có. Web import bằng `@api/notes-shared`; API import bằng `./notes.shared.js`.

```ts
export const MAX_PINNED_NOTES = 3;

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  pinnedAt: string | null; // lúc API nhận yêu cầu ghim, ISO 8601 UTC có mili giây; null khi chưa ghim
}

// true khi pinnedAt là chuỗi; một ghi chú thiếu trường này được tính là chưa ghim.
export function isPinned(note: Pick<Note, 'pinnedAt'>): boolean;
```

`CreateNoteInput` và `NoteList` (`{ data: Note[] }`) không đổi. `POST /notes` không đọc `pinnedAt` gửi lên, nên ghi chú mới luôn chưa ghim.

### `GET /notes`

Như SMP-2, thêm hai điều:

- Mỗi ghi chú có thêm `pinnedAt`.
- `data` xếp theo mục Rules của SPEC: các ghi chú đã ghim trước, ghim gần nhất đứng đầu; rồi tới các ghi chú chưa ghim, mới nhất đứng đầu. Cả hai nhóm xếp theo thứ tự API nhận yêu cầu, không theo các trường thời gian.

```json
{ "data": [
  { "id": "b2…", "title": "Họp thứ hai", "content": "", "createdAt": "2026-11-11T02:00:00.000Z", "pinnedAt": "2026-11-11T03:05:00.000Z" },
  { "id": "a1…", "title": "Mã cửa", "content": "4821", "createdAt": "2026-11-11T01:00:00.000Z", "pinnedAt": "2026-11-11T03:00:00.000Z" },
  { "id": "d4…", "title": "Mua sữa", "content": "2 hộp", "createdAt": "2026-11-11T02:30:00.000Z", "pinnedAt": null }
] }
```

### `POST /notes`

Như SMP-2. Thân của câu trả lời `201` có thêm `"pinnedAt": null`.

### `PUT /notes/:id/pin`: ghim

Trình duyệt gọi `PUT /api/notes/{id}/pin` trên web.

- **Request:** không có thân. API không đọc thân, `Content-Type` hay query; `id` lấy từ đường dẫn.
- **`200`:** có header `Cache-Control: no-store`. Thân là `NoteList`, đúng như `GET /notes` trả về ngay sau thay đổi này.
- **Kết quả**, theo thứ tự API kiểm:

| Thứ tự | Trường hợp | Mã trạng thái | `error.code` | Kho |
|---|---|---|---|---|
| 1 | Không có ghi chú mang `id` này, kể cả `id` sai dạng | 404 | `NOT_FOUND` | Không đổi |
| 2 | Ghi chú đã được ghim | 200 | | Không đổi: giữ `pinnedAt` và chỗ của nó |
| 3 | Đã có `MAX_PINNED_NOTES` ghi chú được ghim | 409 | `PINNED_NOTES_LIMIT_REACHED` | Không đổi |
| 4 | Còn lại | 200 | | Ghi chú được ghim, lên đầu danh sách |

```json
{ "error": { "code": "PINNED_NOTES_LIMIT_REACHED", "message": "The limit of pinned notes is reached." } }
```

### `DELETE /notes/:id/pin`: bỏ ghim

Trình duyệt gọi `DELETE /api/notes/{id}/pin` trên web.

- **Request:** như `PUT`.
- **`200`:** có header `Cache-Control: no-store`. Thân là `NoteList` ngay sau thay đổi.
- Ghi chú chưa ghim: 200, không đổi gì. `id` không có: 404 `NOT_FOUND`. Endpoint này không bao giờ trả 409.

### Method khác trên `/notes/:id/pin`

`GET`, `POST` và `PATCH` trả 404 `NOT_FOUND` vì không có route nào khớp, và kho không đổi. Câu trả lời của preflight `OPTIONS` không có header `Access-Control-Allow-Origin`.

### Dạng lỗi chung: `apps/api/src/common/api-error.ts`

Thêm một mã và một exception:

```ts
export type ApiErrorCode = /* các mã của SMP-2 */ | 'PINNED_NOTES_LIMIT_REACHED';
export class PinnedNotesLimitReachedException extends ConflictException {} // đã có MAX_PINNED_NOTES ghi chú được ghim
```

Bảng của `ApiExceptionFilter` thêm một dòng, ngay sau dòng `NotesLimitReachedException`. Một `ConflictException` khác vẫn là `REQUEST_FAILED`.

| Exception nhận được | Mã trạng thái | `code` | `message` |
|---|---|---|---|
| `PinnedNotesLimitReachedException` | 409 | `PINNED_NOTES_LIMIT_REACHED` | `The limit of pinned notes is reached.` |

### Lớp gọi API của web: `apps/web/src/app/notes/notes-api.ts`

```ts
export class PinnedNotesLimitError extends NotesRequestError {}   // 409 với error.code PINNED_NOTES_LIMIT_REACHED
export function pinNote(id: string): Promise<Note[]>;    // PUT /api/notes/{encodeURIComponent(id)}/pin, trả về data
export function unpinNote(id: string): Promise<Note[]>;  // DELETE /api/notes/{encodeURIComponent(id)}/pin, trả về data
```

- Hai hàm không gửi thân và không đặt `Content-Type`.
- Mỗi yêu cầu chờ tối đa 10 s, như `listNotes` và `createNote`. Các lỗi khác ném ra như `NotesRequestError`, theo quyết định 6.
- `listNotes` và `createNote` không đổi.

## Task List

Plan có một Story và không có Task. Dòng có ô đánh dấu là item Jira; các gạch đầu dòng bên dưới là chi tiết để `ba` viết item. Đếm file không tính file test.

Không item nào có effort `xhigh` hay `max`. Phần bảo mật đều có test chặn: method mà form không gửi được, rewrite chỉ khớp một đoạn, và 404 cho `id` lạ. Sai sót còn lại chỉ làm sai thứ tự của danh sách, không làm mất hay sửa ghi chú nào (NFR, Bảo mật).

### Phase 1: Ghim và bỏ ghim

- [ ] Story 1: Ghim và bỏ ghim (AC1–AC11) · be-dev, fe-dev (Sub-task)
  - Hợp đồng: mục API Contract. Phụ thuộc: không có, vì SMP-2 đã ở `develop`.
  - Design: S1.11, S1.12, S1.15, S1.16, S1.17, S1.18, S1.19, S1.20. S1.13 và S1.14 không đổi.
  - **Sub-task BE**, làm trước. 6 file code, trong đó 3 file chỉ thêm vài dòng:
    - `apps/api/src/notes/notes.shared.ts`: `MAX_PINNED_NOTES`, `pinnedAt` và `isPinned`.
    - `apps/api/src/notes/notes.store.ts`: `pin(id, at)` trả `'PINNED' | 'ALREADY_PINNED' | 'NOT_FOUND' | 'LIMIT_REACHED'`; `unpin(id)` trả `'UNPINNED' | 'NOT_PINNED' | 'NOT_FOUND'`; và `list()` mới, theo quyết định 3.
    - `apps/api/src/notes/notes.service.ts`: `create` đặt `pinnedAt: null`. `pin(id)` và `unpin(id)` gọi kho với `at = new Date().toISOString()`, đổi `NOT_FOUND` sang `NotFoundException` và `LIMIT_REACHED` sang `PinnedNotesLimitReachedException`, rồi trả `list()`.
    - `apps/api/src/notes/notes.controller.ts`: `@Put(':id/pin')` và `@Delete(':id/pin')`, cả hai trả 200 với `@Header('Cache-Control', 'no-store')` và thân `{ data }`. Không dùng `@Body()`.
    - `apps/api/src/common/api-error.ts` và `apps/api/src/common/api-exception.filter.ts`: mã `PINNED_NOTES_LIMIT_REACHED`, như mục "Dạng lỗi chung". Chỉ thêm, không đổi mã cũ.
    - Test, viết theo TDD:
      - Unit `notes.store.spec.ts`, theo Testing Strategy của SPEC: giới hạn ở biên 2, 3 và 4; ghim gần nhất đứng đầu; hai lần ghim cùng mili giây; bỏ ghim thì về đúng chỗ theo thứ tự tạo, kể cả hai ghi chú tạo cùng mili giây; ghim lại thì lên đầu; ghim hai lần, hay bỏ ghim ghi chú chưa ghim, thì không đổi gì; ghim lại một ghi chú đã ghim khi đủ 3 thì thành công; `id` lạ, `__proto__` và `constructor`; `list()` trả bản sao, và object đã đưa ra không bị sửa.
      - Unit `notes.service.spec.ts`: cách đổi kết quả sang exception; `create` có `pinnedAt: null`. Unit `api-exception.filter.spec.ts`: thêm dòng mới. Unit `notes.shared.spec.ts`: `isPinned` với chuỗi, với `null` và khi thiếu trường.
      - Integration `apps/api/test/notes-pin.e2e-spec.ts` (file mới):
        - ghim và bỏ ghim trả 200, `no-store`, và danh sách đúng thứ tự;
        - 409 `PINNED_NOTES_LIMIT_REACHED` ở ghi chú thứ tư; 404 `NOT_FOUND` với `id` lạ và `id` sai dạng; idempotent;
        - ghim không đổi `id`, tiêu đề, nội dung và `createdAt`;
        - thân JSON gửi kèm `PUT`, như `{ "pinnedAt": "2000-01-01T00:00:00.000Z", "title": "x" }`, bị bỏ qua;
        - `GET` và `POST` trên `/notes/:id/pin` trả 404 và kho không đổi;
        - `OPTIONS` có `Origin` lạ và `Access-Control-Request-Method: PUT` thì không có `Access-Control-Allow-Origin`.
      - Integration, cùng file: khi đã có 2 ghi chú ghim, `Promise.all` gửi 5 yêu cầu ghim 5 ghi chú khác nhau. Đúng 1 yêu cầu được 200, 4 yêu cầu nhận 409, và `GET` có đúng 3 ghi chú ghim.
      - Integration, cùng file: nạp 1000 ghi chú dài tối đa, ghim 3, rồi đo `PUT`, `DELETE` và `GET`, mỗi yêu cầu dưới 1 s (NFR, Hiệu năng).
      - Sửa `apps/api/test/notes.e2e-spec.ts`: thân `POST` mong đợi trong `toStrictEqual` có thêm `pinnedAt: null`.
      - Không có E2E: Sub-task BE giữ unit test và integration test của API. E2E AC11 và `pin-helpers.ts` thuộc Sub-task FE (quyết định 12).
  - **Sub-task FE**, 5 file code và 1 mục cấu hình:
    - `apps/web/next.config.ts`: thêm mục rewrite theo quyết định 5, và sửa chú thích "Exactly one path is forwarded".
    - `apps/web/src/app/notes/notes-api.ts`: như mục API Contract.
    - `apps/web/src/app/notes/notes-view.tsx`: làm theo quyết định 7, 8 và 9. Gọi `pinNote` và `unpinNote`. Sau một lần 409, gọi `listNotes` đúng một lần; nếu không tải được thì chuyển sang trạng thái `error`, và khối S1.15 nhận focus.
    - `apps/web/src/app/notes/note-list.tsx`: mỗi `li` có S1.16 khi ghi chú đã ghim, đứng trước h3 trong DOM. h3 có `id` riêng, như `note-title-<id>`. Sau đó là S1.17, và S1.19 khi có lỗi. Vùng S1.20 nằm ngoài `ul`.
    - `apps/web/src/app/notes/pin-button.tsx` (file mới) vẽ S1.17 và S1.18 với các trạng thái của design:
      - `aria-labelledby="<id của nút> <id của h3>"`;
      - `aria-disabled` cho pending và cho nút khóa, không dùng `disabled`; `aria-busy` khi pending;
      - `aria-describedby` trỏ tới S1.18 khi nút khóa, thêm S1.19 khi có lỗi;
      - hiện và ẩn S1.18 theo bấm, trỏ chuột, focus, bấm ra ngoài và Esc, như S1.18.
    - Nếu `notes-view.tsx` dài quá, có thể tách trạng thái riêng của từng ghi chú (quyết định 8) ra `apps/web/src/app/notes/use-note-pins.ts`.
    - Test:
      - Unit `next.config.test.ts`: danh sách `source` là `['/api/notes', '/api/notes/:id/pin']`; đích của mục mới đúng khi có và khi không có `API_URL`.
      - Unit `notes-api.test.ts`:
        - method và đường dẫn đúng, có `encodeURIComponent`;
        - 409 với mã đúng thì ra `PinnedNotesLimitError`;
        - 409 với thân hỏng, 404, 500, lỗi mạng hay quá 10 s (`vi.useFakeTimers()`) thì ra `NotesRequestError`.
      - Integration với Testing Library, `fetch` được giả lập (`notes-view.test.tsx`, `note-list.test.tsx`, `pin-button.test.tsx`):
        - ghim hay bỏ ghim thì danh sách đổi đúng như câu trả lời, focus ở nút của ghi chú đó, và S1.20 có đúng câu;
        - mỗi lần bấm gửi đúng 1 yêu cầu, không có `GET` sau một lần thành công, và có đúng 1 `GET` sau 409;
        - bấm đôi chỉ gửi 1 yêu cầu;
        - nút khóa và mở ở mốc 3 trong cùng lần vẽ; ghi chú mới tạo nằm ngay dưới nhóm đã ghim, và bị khóa ngay nếu đã đủ 3;
        - dòng nhắc là mô tả truy cập của nút khóa; hiện khi bấm, trỏ chuột hay focus; Esc ẩn nó; nó mất khi nút mở lại;
        - lỗi chỉ hiện ở ghi chú của nó, mất khi bấm lại, và còn khi danh sách được thay; lỗi cũ vẫn còn khi nút bị khóa, và mô tả của nút gồm cả S1.18 lẫn S1.19;
        - hai câu trả lời tới ngược thứ tự thì danh sách cũ bị bỏ qua; ghi chú vừa tạo không mất khi một danh sách tới mà thiếu nó;
        - 409 rồi tải lại không được thì hiện lỗi tải S1.15, và S1.15 có focus.
      - E2E (quyết định 12):
        - `e2e/notes-pin/pin-helpers.ts`: `uniqueTitle`, `createNote`, `pinNote`, `unpinNote` và `itemWithTitle`, tất cả gửi qua web;
        - AC1–AC7 và AC11 trong `e2e/notes-pin/pin-real-notes.spec.ts`;
        - AC8, AC9 và AC10 trong `e2e/notes-pin/pin-limit-faked.spec.ts`.
      - Sửa E2E của SMP-2:
        - `e2e/notes/create-note.spec.ts`: hàm `firstNote` lấy mục đầu tiên không có chữ "Đã ghim". AC1, AC2 và AC7 dùng hàm này.
        - `e2e/notes/notes-limit.spec.ts`: ghi chú giả có thêm `pinnedAt: null`.
      - `e2e/smoke.spec.ts`: thêm một ca `PUT /api/notes/<uuid ngẫu nhiên>/pin` qua web, phải trả 404 JSON `NOT_FOUND`, cho thấy rewrite tới được API; và một ca `GET /api/notes/x`, phải trả 404 HTML của web.
  - Kiểm tay trước review: nạp 1000 ghi chú dài tối đa bằng lệnh ở Story 6 của plan SMP-2, chạy `npm run build` rồi `next start`. Đo bằng DevTools từ lúc bấm Ghim hay Bỏ ghim tới lúc ghi chú hiện ở chỗ mới; phải ≤ 1 s (NFR). Ghi kết quả vào PR.

### Checkpoint: Hoàn tất

- [ ] `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run test:e2e -w api`, `npm run build` và `npm run test:e2e` đều pass.
- [ ] Trên Development, E2E AC1–AC11 của SMP-23 pass khi chưa ai giữ đủ 3 chỗ ghim (rủi ro chấp nhận trong Testing Strategy của SPEC). E2E AC1–AC15 của SMP-2 và smoke pass, kể cả khi đang có 1 tới 3 ghi chú được ghim.
- [ ] Gửi thẳng qua web: `PUT /api/notes/<id>/pin` cho ghi chú thứ tư nhận 409 `PINNED_NOTES_LIMIT_REACHED`, `POST /api/notes/<id>/pin` nhận 404, và kho vẫn có đúng 3 ghi chú được ghim.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| E2E chập chờn vì trạng thái ghim là chung cho cả kho, mà Playwright chạy song song | Medium | Mọi test ghim thật nằm trong một file chạy lần lượt, kể cả AC11. AC8–AC10 giả lập câu trả lời. Test bỏ ghim những gì nó đã ghim trong `finally` (quyết định 12) |
| Có người giữ đủ 3 chỗ ghim trên Development lúc QA chạy, nên AC1–AC7 fail | Medium | SPEC chấp nhận rủi ro này: bạn bỏ ghim trên Development rồi chạy lại QA. Test không bỏ ghim ghi chú của người khác |
| E2E của SMP-2 fail khi có ghi chú được ghim | Medium | Sub-task FE sửa `firstNote` trong `create-note.spec.ts` (AC1, AC2, AC7) và câu trả lời giả của `notes-limit.spec.ts`. Checkpoint chạy chúng khi đang có ghi chú được ghim |
| Câu trả lời của hai yêu cầu ghim tới ngược thứ tự, nên trang hiện trạng thái cũ | Low | Danh sách cũ hơn bị bỏ qua (quyết định 7). Còn lại một rủi ro: nếu API xử lý hai yêu cầu của một trang theo thứ tự khác thứ tự gửi, trang hiện trạng thái cũ cho tới khi tải lại; trạng thái ở API và giới hạn 3 không sai (ADR-0004) |
| Ai đó thêm `await` giữa bước kiểm giới hạn và bước ghim, làm có ghi chú ghim thứ tư | Medium | `pin()` của kho là hàm đồng bộ (quyết định 3). Integration test gửi các yêu cầu ghim cùng lúc bằng `Promise.all` sẽ fail ngay |
| Nút mất focus khi React di chuyển `li` | Medium | Web tự trả focus (quyết định 9). E2E AC1 và AC6 kiểm `toBeFocused()` |
| Rewrite mở thêm đường của API | Low | Chỉ khớp một đoạn `:id`, và đích kết thúc bằng `/pin` (quyết định 5). Có `next.config.test.ts` và hai ca mới của smoke |
| Mỗi lần ghim trả cả danh sách: tối đa vài MB với 1000 ghi chú dài tối đa | Low | Nặng bằng `GET` hiện có, và được đo theo NFR. Nếu `GET` có phân trang ở Epic sau, câu trả lời của ghim phải đổi theo (ADR-0004) |
| Sub-task FE nặng về logic: cả 10 tiêu chí có giao diện nằm trong một lượt làm | Medium | Plan chốt trước mọi quy tắc trạng thái (quyết định 7–11), và test được viết theo TDD. Nếu `fe-dev` thấy không vừa một lượt, hãy tách Story theo chiều dọc: "Ghim và bỏ ghim" (AC1–AC7), rồi "Giới hạn 3 ghi chú được ghim" (AC8–AC11), và giữ kiểm giới hạn ở API ngay trong Story đầu |
| E2E của SMP-23 chạy trên Development tạo khoảng 20 ghi chú mỗi lần. Kho đầy ở 1000 thì test tạo ghi chú fail cho tới lần deploy sau | Low | Mỗi test chỉ tạo những ghi chú tiêu chí của nó cần. Mỗi lần deploy làm trống kho (NFR, Phạm vi chạy) |

## Open Questions

Không có.
