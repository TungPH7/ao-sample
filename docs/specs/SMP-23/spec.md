# Spec: Ghim ghi chú lên đầu danh sách

> **Epic:** SMP-23 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-23 · **Status:** Draft

## Objective

Danh sách ghi chú xếp mới nhất lên đầu (SPEC của SMP-2), nên mỗi ghi chú mới lại đẩy một ghi chú quan trọng xuống thêm một bậc. Epic này cho người dùng ghim tối đa 3 ghi chú, để chúng luôn nằm ở đầu danh sách, và bỏ ghim khi không cần nữa.

Đây cũng là Epic thử cho lần chạy thật của các lệnh human-loop của kit: intake, sửa SPEC và plan, xem trước, sửa lỗi sau QA fail.

**Thành công nghĩa là:** người dùng ghim và bỏ ghim được ngay trên danh sách, không phải tải lại trang. Ghi chú đã ghim nằm trên cùng, có dấu hiệu dễ nhận ra, và vẫn được ghim khi tải lại trang hay mở ở trình duyệt khác. Không cách nào, kể cả gọi thẳng API, làm cho có hơn 3 ghi chú được ghim.

**Người dùng:** bất kỳ ai mở trang Ghi chú `/notes`. Ứng dụng không có đăng nhập, nên mọi người dùng chung một danh sách và chung các ghi chú đã ghim: một người ghim thì mọi người đều thấy ghi chú đó được ghim, và ai cũng bỏ ghim được.

**Màn hình:** Epic đụng tới giao diện, nên `ux` vẽ phần thay đổi của màn hình S1 Ghi chú (của SMP-2) trong `docs/specs/SMP-23/design.md`, cạnh file này, và trỏ tới các tiêu chí bằng mã `AC<n>` bên dưới. Phần thay đổi nằm ở mỗi mục của danh sách (khối [11] tới [14] của S1): nút Ghim hoặc Bỏ ghim, dấu Đã ghim, dòng nhắc khi đã đủ 3, thông báo lỗi riêng của từng ghi chú, và trạng thái của nút trong lúc chờ API.

### Rules

**Thứ tự danh sách.** Quy tắc này thay cho quy tắc "mới nhất lên đầu" ở mục Rules của SPEC SMP-2:

1. Các ghi chú đã ghim đứng đầu. Ghi chú ghim gần nhất đứng trên, theo thứ tự API nhận yêu cầu ghim, kể cả hai lần ghim trong cùng một mili giây.
2. Sau đó tới các ghi chú chưa ghim, giữ thứ tự của SMP-2: mới nhất lên đầu, theo thứ tự API nhận yêu cầu tạo.
3. Bỏ ghim một ghi chú thì nó về đúng chỗ của nó theo thời gian tạo, giữa các ghi chú chưa ghim, chứ không lên đầu.
4. Ghim lại một ghi chú vừa bỏ ghim thì nó lên đầu nhóm đã ghim, như một lần ghim mới.
5. Ghi chú mới tạo đứng đầu nhóm chưa ghim, tức ngay dưới các ghi chú đã ghim. Khi chưa ghim ghi chú nào thì vẫn là đầu danh sách, như SMP-2.

**Giới hạn.** Tối đa 3 ghi chú được ghim cùng lúc. API kiểm giới hạn này, không chỉ giao diện chặn. Con số 3 là một hằng số có tên, dùng chung cho web và API.

- Khi danh sách trên trang đã có 3 ghi chú được ghim, nút Ghim của mọi ghi chú chưa ghim bị khóa, kèm dòng nhắc. Nút Bỏ ghim của 3 ghi chú đã ghim vẫn bấm được.
- Web khóa nút theo danh sách nó đang có. Danh sách có thể cũ, vì có người vừa ghim từ trình duyệt khác. Khi đó API là nơi quyết định: nó từ chối, và web tải lại danh sách (AC10).
- Ghim một ghi chú đã được ghim thì thành công và không đổi gì: ghi chú giữ chỗ trong nhóm đã ghim và không bị tính thêm vào giới hạn. Bỏ ghim một ghi chú chưa ghim cũng thành công và không đổi gì. Nhờ vậy, hai người bấm cùng một nút gần như cùng lúc đều thấy kết quả mình muốn, không ai thấy lỗi.

**Khi nào trang đổi.**

- Ghi chú chỉ đổi trạng thái và đổi chỗ khi API trả lời thành công, không đổi trước rồi trả lại khi lỗi.
- Trong lúc chờ API, nút của ghi chú đó hiện trạng thái đang xử lý, và bấm thêm không gửi thêm yêu cầu (AC4).
- Sau khi ghim hoặc bỏ ghim thành công, thứ tự trên trang khớp đúng thứ tự mà API trả về khi tải lại trang, không cần tải lại.
- Sau khi bấm, focus bàn phím ở lại nút của chính ghi chú đó, dù ghi chú đã chuyển chỗ, để người dùng bàn phím không bị mất chỗ đang đứng.
- Trang không tự cập nhật khi người khác ghim hay bỏ ghim. Người dùng thấy trạng thái mới khi tải lại trang, hoặc khi API từ chối vì đã đủ 3 (AC10).

**Khi lỗi.**

- Ghim hoặc bỏ ghim không thành, do lỗi mạng, lỗi máy chủ, hay quá 10 s không trả lời như SMP-2: ghi chú giữ nguyên trạng thái và chỗ cũ, và một thông báo lỗi hiện ngay cạnh ghi chú đó.
- Mỗi ghi chú có thông báo lỗi riêng. Thông báo mất khi bấm lại nút của ghi chú đó, hoặc khi tải lại trang.
- Ghi chú không còn ở API, chẳng hạn vì API đã khởi động lại sau khi trang được mở, cũng hiện thông báo lỗi ghim hay bỏ ghim như trên. Tải lại trang thì thấy danh sách mới.
- Sau khi API từ chối vì đã đủ 3, nếu tải lại danh sách không được thì vùng danh sách hiện lỗi tải của SMP-2 (AC13 của SMP-2).

**Chữ trên giao diện**, đúng nguyên văn:

| Chỗ | Chữ |
|---|---|
| Nút của ghi chú chưa ghim | Ghim |
| Nút của ghi chú đã ghim | Bỏ ghim |
| Dấu của ghi chú đã ghim | Đã ghim |
| Dòng nhắc kèm nút Ghim bị khóa | Bỏ ghim một ghi chú để ghim ghi chú này |
| Ghim không thành | Không ghim được ghi chú. Vui lòng thử lại. |
| Bỏ ghim không thành | Không bỏ ghim được ghi chú. Vui lòng thử lại. |

Hai thông báo lỗi ghim và bỏ ghim là đề xuất, chờ bạn duyệt (Open Questions 2).

### User Stories

**Story: Ghim ghi chú.** Là người dùng, tôi muốn ghim một ghi chú quan trọng lên đầu danh sách, để ghi chú mới không đẩy nó xuống.

- AC1: Given ghi chú A chưa ghim và đang có ít hơn 3 ghi chú được ghim, When bấm Ghim ở A, Then A lên đầu danh sách với dấu "Đã ghim", nút của A thành "Bỏ ghim", focus ở lại nút của A, và không cần tải lại trang.
- AC2: Given đã ghim A rồi tới B, và có hai ghi chú chưa ghim C rồi D (D tạo sau C), When tải lại trang, hoặc mở trang Ghi chú ở một trình duyệt khác, Then thấy theo thứ tự B, A, D, C; B và A có dấu "Đã ghim", còn D và C thì không.
- AC3: Given A đã được ghim, When tạo ghi chú mới E bằng form, Then A vẫn ở đầu danh sách, còn E hiện ngay dưới các ghi chú đã ghim, trên mọi ghi chú chưa ghim khác, và không cần tải lại trang.
- AC4: Given đã bấm Ghim hoặc Bỏ ghim ở A và API chưa trả lời, When bấm nút đó thêm lần nữa, Then chỉ một yêu cầu được gửi, và A chỉ đổi trạng thái một lần.
- AC5: Given API không ghim được, do lỗi mạng, lỗi máy chủ hoặc quá 10 s không trả lời, When bấm Ghim ở A, Then A vẫn chưa ghim và ở nguyên chỗ, và thấy "Không ghim được ghi chú. Vui lòng thử lại." ngay cạnh A, không ở ghi chú nào khác.

**Story: Bỏ ghim ghi chú.** Là người dùng, tôi muốn bỏ ghim một ghi chú khi không cần nó ở đầu nữa, để nhường chỗ cho ghi chú khác.

- AC6: Given A đã được ghim, A được tạo sau C và trước D, và C, D chưa ghim, When bấm Bỏ ghim ở A, Then A mất dấu "Đã ghim", nút của A thành "Ghim", A về giữa D và C theo thời gian tạo, focus ở lại nút của A, và không cần tải lại trang; tải lại trang vẫn thấy A chưa ghim, ở đúng chỗ đó.
- AC7: Given API không bỏ ghim được, do lỗi mạng, lỗi máy chủ hoặc quá 10 s không trả lời, When bấm Bỏ ghim ở A, Then A vẫn được ghim và ở nguyên chỗ, và thấy "Không bỏ ghim được ghi chú. Vui lòng thử lại." ngay cạnh A, không ở ghi chú nào khác.

**Story: Giới hạn 3 ghi chú được ghim.** Là người dùng, tôi muốn chỉ có tối đa 3 ghi chú được ghim, để đầu danh sách luôn gọn và đúng là những ghi chú quan trọng nhất.

- AC8: Given đã có 3 ghi chú được ghim, When xem một ghi chú chưa ghim B, Then nút Ghim của B bị khóa, kèm dòng nhắc "Bỏ ghim một ghi chú để ghim ghi chú này"; bấm nút đó không ghim B và không gửi yêu cầu nào; còn nút Bỏ ghim của 3 ghi chú đã ghim vẫn bấm được.
- AC9: Given đã có 3 ghi chú được ghim và nút Ghim của B đang khóa, When bỏ ghim một trong 3 ghi chú đó, Then nút Ghim của B mở lại và dòng nhắc biến mất, không cần tải lại trang.
- AC10: Given trang đang hiện ít hơn 3 ghi chú được ghim, nhưng ở API đã đủ 3 vì có người vừa ghim từ trình duyệt khác, When bấm Ghim ở B, Then B vẫn chưa ghim, danh sách tự tải lại và hiện đủ 3 ghi chú đã ghim ở đầu, và nút Ghim của B bị khóa, kèm dòng nhắc như AC8.
- AC11: Given đã có 3 ghi chú được ghim, When một yêu cầu ghim một ghi chú khác gửi thẳng tới API, không qua giao diện, Then API trả lỗi 409, và không ghi chú nào đổi trạng thái: danh sách API trả về vẫn có đúng 3 ghi chú được ghim, và ghi chú vừa bị từ chối vẫn chưa ghim.

### Changes to SMP-2

Epic này đổi hành vi mà SPEC đã duyệt của SMP-2 tả. SPEC của SMP-2 giữ nguyên; phần dưới đây thay cho nó ở những chỗ được nêu.

- **Thứ tự:** mục "Danh sách" (Rules) và "Thứ tự" (NFR) của SMP-2 nay theo mục Rules ở trên: ghi chú đã ghim đứng trước.
- **AC1, AC2 của SMP-2:** "ghi chú hiện ở đầu danh sách" nay nghĩa là ở đầu các ghi chú chưa ghim, ngay dưới các ghi chú đã ghim (AC3 ở trên). E2E của hai tiêu chí đó, ở `e2e/notes/create-note.spec.ts`, đang lấy mục đầu tiên của danh sách. Chúng phải được sửa trong Epic này, để vẫn pass khi có ghi chú được ghim.
- **AC15 của SMP-2:** "mới nhất ở đầu" nay hiểu là mới nhất ở đầu các ghi chú chưa ghim. Các câu trả lời `GET` giả lập trong `e2e/notes/notes-limit.spec.ts` mang thêm trạng thái ghim, nếu hợp đồng API đòi.
- **Kho đầy 1000 ghi chú (AC14 của SMP-2):** ghim và bỏ ghim vẫn chạy, vì chúng không tạo ghi chú.

### Out of Scope

- Kéo thả để đổi thứ tự các ghi chú đã ghim.
- Ghim riêng cho từng người dùng, và đăng nhập.
- Sửa hoặc xóa ghi chú.
- Lưu ghi chú và trạng thái ghim bền vững qua các lần API khởi động lại: thuộc SMP-19.
- Giới hạn tần suất cho việc ghim: thuộc SMP-19, cùng với giới hạn tần suất của việc tạo ghi chú.
- Cập nhật trang ngay khi người khác ghim hay bỏ ghim (hỏi định kỳ, WebSocket): người dùng tải lại trang.
- Đổi giới hạn 3, hay cho mỗi người tự chọn giới hạn.
- Hiện số ghi chú đã ghim, như "2/3", trừ khi design.md vẽ nó.

### Non-functional requirements

**Phạm vi chạy.** Như SMP-2: máy dev, CI, và ba môi trường Development, Staging, Production trên VPS. Chỉ web ra Internet, và trình duyệt gọi API qua đường `/api/...` của web (ADR-0002). Mỗi lần deploy chạy một API mới với kho rỗng, nên ghi chú và trạng thái ghim của môi trường đó cùng mất.

**Hiệu năng.** Khối lượng tính toán như SMP-2: tối đa 1000 ghi chú dài tối đa, trong đó 3 ghi chú được ghim.

| Chỉ số | Mục tiêu | Kiểm bằng |
|---|---|---|
| Thời gian API trả lời yêu cầu ghim, bỏ ghim, và `GET` danh sách, khi kho có 1000 ghi chú dài tối đa và 3 ghi chú được ghim | ≤ 200 ms ở p95 trên máy dev, không tính mạng | Integration test nạp 1000 ghi chú, ghim 3, rồi gọi từng yêu cầu. Ngưỡng của test nới ra 1 s như SMP-2 |
| Từ lúc bấm Ghim hay Bỏ ghim tới lúc ghi chú hiện ở chỗ mới | ≤ 1 s, khi web và API chạy cùng máy | Đo tay một lần bằng DevTools; E2E AC1 và AC6 kiểm là không tải lại trang |
| Số yêu cầu tới API | Mỗi lần bấm Ghim hay Bỏ ghim gửi đúng 1 yêu cầu đổi trạng thái ghim. Sau đó web gửi thêm tối đa 1 `GET`, và gửi đúng 1 `GET` khi API từ chối vì đã đủ 3. Plan chọn có gọi lại `GET` sau một lần thành công hay không, miễn thứ tự trên trang khớp mục Rules | Integration test của web, API được giả lập |
| Khóa và mở nút Ghim khi số ghi chú được ghim đổi | Trong cùng lần vẽ của câu trả lời làm số đó đổi | Unit test của danh sách |
| Thời gian web chờ một yêu cầu ghim hay bỏ ghim | Tối đa 10 s như SMP-2; quá thời gian thì tính là lỗi (AC5, AC7) | Integration test của web dùng đồng hồ giả |

**Bảo mật.** Như SMP-2, không có đăng nhập, nên ai gọi được API cũng ghim và bỏ ghim được mọi ghi chú. Đó là chủ ý của Epic (Out of Scope). Các yêu cầu riêng của việc ghim:

- **Kiểm ở biên API:** API chỉ đổi trạng thái của ghi chú có `id` trong kho. `id` lạ, kể cả sai dạng, trả 404 `NOT_FOUND` và không đổi gì. Việc ghim không nhận dữ liệu nào khác: API không đọc thân yêu cầu để lấy tiêu đề, nội dung, thời gian hay thứ tự.
- **Không có hơn 3:** API kiểm giới hạn và ghim trong cùng một bước, không chờ việc gì khác ở giữa. Nhờ vậy, nhiều yêu cầu ghim tới cùng lúc vẫn không làm cho có 4 ghi chú được ghim. Yêu cầu bị từ chối vì đã đủ 3 trả 409 với một mã lỗi mới, như `PINNED_NOTES_LIMIT_REACHED`. Plan chốt tên mã; thêm mã là thay đổi cộng thêm theo ADR-0003. Web phân biệt được lỗi này với các lỗi khác (AC10 với AC5).
- **Form HTML ở trang khác không gọi được việc ghim:** yêu cầu ghim và bỏ ghim dùng method mà form HTML không gửi được, như `PUT` hay `DELETE`, hoặc chỉ nhận `Content-Type: application/json` như `POST /notes` của SMP-2. Cùng lý do với mục "Chỉ nhận JSON" của SMP-2.
- **Rewrite của web:** web chuyển tiếp thêm đúng đường dẫn của việc ghim tới API, không mở các đường khác của API (ADR-0002 đòi mỗi đường mới được thêm có chủ ý).
- **Lỗi trả về và log:** như SMP-2 và ADR-0003: mọi lỗi cùng một dạng JSON, không stack trace, không ghi tiêu đề hay nội dung ghi chú vào log. Log yêu cầu, nếu có, gồm method, đường dẫn (có `id` của ghi chú), mã trạng thái và thời gian xử lý.
- **XSS:** các chữ mới trên giao diện là chữ cố định. Tiêu đề và nội dung vẫn chỉ vào trang dưới dạng chữ do React escape, như AC12 của SMP-2.
- **Rủi ro chấp nhận tới SMP-19:** không có giới hạn tần suất, nên một người có thể giữ 3 chỗ ghim cho ghi chú của mình, hay liên tục bỏ ghim ghi chú người khác ghim. Thiệt hại chỉ là thứ tự của danh sách: không ghi chú nào mất hay bị sửa. Để SMP-19 xét: thêm việc ghim vào giới hạn tần suất; và nếu SMP-19 chọn đẩy ghi chú cũ nhất ra khi kho đầy, thì quyết định ghi chú đã ghim có bị đẩy ra không.

**Dữ liệu và thời gian lưu.**

- **Nơi lưu:** trạng thái ghim lưu ở API, cùng ghi chú, trong bộ nhớ của tiến trình API duy nhất. Nó mất khi API khởi động lại hoặc deploy, cùng lúc với ghi chú.
- **Web không lưu trạng thái ghim ở trình duyệt:** không localStorage, IndexedDB, cookie hay service worker. Trạng thái ghim chỉ đến từ API, nên mọi trình duyệt thấy như nhau (AC2).
- **Một ghi chú có thêm trạng thái ghim**, và thứ tự ghim của nó khi được ghim. `GET` trả danh sách đã xếp theo mục Rules, mỗi ghi chú kèm trạng thái ghim; web không tự sắp lại theo thời gian. Plan chốt tên trường và dạng của nó trong hợp đồng API, chẳng hạn `pinnedAt` là thời điểm ghim dạng ISO 8601 UTC có mili giây, hoặc `null` khi chưa ghim. Thêm trường vào `Note` là thay đổi cộng thêm.
- **Ghim không đổi ghi chú:** `id`, tiêu đề, nội dung và thời gian tạo giữ nguyên khi ghim hay bỏ ghim.
- **Không cache:** như SMP-2, `GET` có `Cache-Control: no-store`. Câu trả lời của yêu cầu ghim cũng không được cache.
- **Gửi lại:** ghim và bỏ ghim là idempotent theo mục Rules: gửi lại cùng yêu cầu cho cùng kết quả. Web vẫn không tự gửi lại khi lỗi.

## Tech Stack

Như README và SMP-2: Next.js 16.4.3, React 19.3.0, NestJS 12 (bản cài 12.3.2), Vitest 4, Playwright 1.64.1, Node.js 24. Ghi chú và trạng thái ghim nằm trong bộ nhớ của tiến trình API, không có cơ sở dữ liệu.

Epic không thêm thư viện npm nào. Hằng số giới hạn 3 và kiểu `Note` có trạng thái ghim nằm trong `apps/api/src/notes/notes.shared.ts`, file mà web import qua alias `@api/notes-shared` (ADR-0001).

## Commands

Không đổi so với README và SMP-2:

```
npm run dev                  # web ở http://localhost:3000, api ở http://localhost:3001
npm run lint
npm run typecheck
npm run test:coverage        # Vitest cho cả hai app
npm run test:e2e -w api      # integration test của API (supertest), ở apps/api/test/
npm run build
npm run test:e2e             # Playwright, tự chạy hai app
```

## Project Structure

`sa` chốt tên file trong plan.

```
apps/api/src/notes/                 → trạng thái ghim trong kho, giới hạn 3, endpoint ghim và bỏ ghim; unit test *.spec.ts cạnh file
apps/api/src/notes/notes.shared.ts  → hằng số giới hạn 3 và kiểu Note có trạng thái ghim, dùng chung với web (ADR-0001)
apps/api/src/common/                → mã lỗi mới cho giới hạn ghim (ADR-0003)
apps/api/test/                      → integration test của việc ghim
apps/web/next.config.ts             → rewrite cho đường ghim (ADR-0002)
apps/web/src/app/notes/             → nút Ghim và Bỏ ghim, dấu Đã ghim, dòng nhắc, lỗi của từng ghi chú, thứ tự danh sách; test *.test.tsx cạnh file
e2e/notes-pin/                      → E2E của SMP-23, một test cho mỗi tiêu chí AC1–AC11
e2e/notes/create-note.spec.ts       → sửa E2E AC1, AC2 của SMP-2 theo mục Changes to SMP-2
docs/specs/SMP-23/                  → spec.md, design.md, plan.md của Epic
```

E2E của Epic này nằm ở `e2e/notes-pin/`, tách khỏi `e2e/notes/`, vì mã tiêu chí của mỗi Epic bắt đầu từ AC1: "AC1" của SMP-23 khác "AC1" của SMP-2.

## Code Style

Như SMP-2 và cấu hình sẵn có. Import nội bộ của `apps/api` kết thúc bằng `.js`, và tên mỗi E2E test bắt đầu bằng mã tiêu chí của SMP-23.

Thêm một quy ước: E2E nào ghim một ghi chú thật thì bỏ ghim nó khi xong, kể cả khi test fail, và chỉ bỏ ghim những ghi chú chính test đó đã ghim. Hàm `pinNote` và `unpinNote` gọi endpoint mà plan chốt:

```ts
test('AC1 pins a note to the top of the list without reloading the page', async ({ page, request }) => {
  const note = await createNote(request, { title: uniqueTitle('AC1'), content: '' });
  try {
    await page.goto('/notes');
    const item = itemWithTitle(page, note.title);
    await item.getByRole('button', { name: /^Ghim/ }).click();
    await expect(item.getByRole('button', { name: /^Bỏ ghim/ })).toBeFocused();
  } finally {
    await unpinNote(request, note.id);
  }
});
```

## Testing Strategy

- **Unit, viết theo TDD cho mỗi Story** (Vitest):
  - Ở API: kho ghim và bỏ ghim; giới hạn 3, gồm biên 2, 3 và 4; thứ tự theo mục Rules: ghim gần nhất lên trên, hai lần ghim cùng mili giây, bỏ ghim về đúng chỗ theo thời gian tạo, ghim lại lên đầu; ghim hai lần và bỏ ghim ghi chú chưa ghim không đổi gì; `id` lạ.
  - Ở web: thứ tự sau khi ghim và bỏ ghim; khóa và mở nút ở 3; dòng nhắc; lỗi riêng của từng ghi chú và lúc nó mất; bấm đôi; focus sau khi ghi chú đổi chỗ.
- **Integration, viết theo TDD cho mỗi Story:**
  - API qua supertest: ghim, bỏ ghim, 409 ở ghi chú thứ tư, 404 với `id` lạ, idempotent, thứ tự và trạng thái ghim trong `GET`, method hay `Content-Type` mà form HTML gửi được bị từ chối.
  - Nhiều yêu cầu ghim cùng lúc (`Promise.all`) khi đã có 2 ghi chú được ghim: đúng một yêu cầu thành công, các yêu cầu còn lại nhận 409.
  - Thời gian trả lời với 1000 ghi chú, theo bảng Hiệu năng.
  - Web với Testing Library, API được giả lập: số yêu cầu, quá giờ, phân biệt 409 với lỗi khác.
- **E2E** (Playwright, `e2e/notes-pin/`): một test cho mỗi tiêu chí AC1–AC11, tên bắt đầu bằng mã tiêu chí. AC2 mở trang ở một browser context mới để giả một trình duyệt khác. AC11 gửi yêu cầu thẳng tới API bằng `request`, như AC9 của SMP-2.
- **Trạng thái ghim dùng chung khi chạy E2E**, khó hơn ở SMP-2. Playwright chạy song song trên một tiến trình API. Trạng thái ghim là chung cho cả kho, và còn lại giữa các lần chạy trên Development cho tới lần deploy sau. Vì vậy:
  - Test cần biết chính xác số ghi chú được ghim (AC8, AC9, AC10) giả lập câu trả lời của API bằng `page.route`, như SMP-2 làm cho AC7, AC8, AC10, AC13.
  - Test ghim ghi chú thật (AC1–AC7) nằm chung một file chạy tuần tự, và bỏ ghim những gì mình ghim, theo mục Code Style.
  - AC11 ghim lần lượt ghi chú của chính nó cho tới khi API trả 409. Nhờ vậy test đúng dù trước đó đã có bao nhiêu ghi chú được ghim. Xong thì nó bỏ ghim những ghi chú nó đã ghim.
  - Plan của `sa` nói cách làm chi tiết, trong giới hạn của mục Boundaries.
- **Regression:** toàn bộ E2E của SMP-2 và `e2e/smoke.spec.ts` vẫn pass, kể cả khi đang có 1 tới 3 ghi chú được ghim, sau khi sửa theo mục Changes to SMP-2.

## Boundaries

- **Always:**
  - API kiểm lại giới hạn 3 và `id`, không tin web. Web và API dùng cùng một hằng số giới hạn.
  - Trạng thái ghim chỉ đến từ API.
  - Mọi chữ trên giao diện bằng tiếng Việt, đúng nguyên văn ở mục Rules.
  - Mỗi nút Ghim hay Bỏ ghim cho trình đọc màn hình biết nó thuộc ghi chú nào. Dấu Đã ghim có chữ, không chỉ là biểu tượng hay màu. Nút Ghim bị khóa vẫn nhận focus, và dòng nhắc là mô tả của nút để trình đọc màn hình đọc được. Thông báo lỗi ghim được gắn với ghi chú của nó.
- **Ask first:**
  - Đổi giới hạn 3, hay đổi chữ trên giao diện.
  - Thêm endpoint chỉ dùng cho test, như bỏ mọi ghim hay xóa kho.
  - Thêm cách lưu bền vững, hay cách cập nhật trang tức thì (hỏi định kỳ, WebSocket).
  - Thêm thư viện npm.
  - Làm tính năng ở mục Out of Scope.
- **Never:**
  - Lưu trạng thái ghim ở trình duyệt.
  - Để có hơn 3 ghi chú được ghim ở API.
  - Để E2E bỏ ghim một ghi chú mà chính nó không ghim.
  - Mở thêm đường của API qua rewrite ngoài việc ghim.
  - Đưa tiêu đề hay nội dung vào trang dưới dạng HTML, hay ghi chúng vào log.
  - Sửa SPEC đã duyệt của SMP-2 trong Epic này: thay đổi nằm ở mục Changes to SMP-2.

## Success Criteria

- Ba Story trên đạt DoD, và E2E của từng tiêu chí AC1–AC11 đều pass trên môi trường Development.
- Không chuỗi yêu cầu nào, qua giao diện hay gửi thẳng tới API, kể cả gửi cùng lúc, làm cho có hơn 3 ghi chú được ghim.
- Trạng thái ghim giống nhau ở mọi trình duyệt, và còn nguyên sau khi tải lại trang, cho tới khi API khởi động lại.
- Mỗi chữ ở mục Rules hiện đúng nguyên văn, đúng chỗ, và đọc được bằng trình đọc màn hình.
- E2E của SMP-2 (AC1–AC15) và smoke test vẫn pass, kể cả khi đang có ghi chú được ghim.

## Open Questions

1. **API từ chối ghim vì đã đủ 3**, chẳng hạn người khác vừa ghim từ trình duyệt khác (Open Point của Epic). Đề xuất của Epic: giao diện tải lại danh sách và hiện dòng nhắc như khi nút Ghim bị khóa. SPEC viết theo đề xuất này ở AC10.
2. **Ghim hay bỏ ghim không thành do lỗi mạng hay lỗi máy chủ** (Open Point của Epic). Đề xuất của Epic: ghi chú giữ trạng thái cũ, và một thông báo lỗi hiện ngay cạnh ghi chú đó. SPEC viết theo đề xuất này ở AC5 và AC7, và đề xuất thêm:
   - Nguyên văn hai thông báo: "Không ghim được ghi chú. Vui lòng thử lại." và "Không bỏ ghim được ghi chú. Vui lòng thử lại.", theo kiểu thông báo lỗi lưu của SMP-2.
   - Thông báo mất khi bấm lại nút của ghi chú đó, hoặc khi tải lại trang.
3. **Dòng nhắc khi đã đủ 3 hiện ở đâu.** Danh sách có thể dài tới 1000 ghi chú, nên lặp cùng một dòng nhắc ở mọi ghi chú chưa ghim thì rối. Đề xuất: dòng nhắc luôn là mô tả của nút bị khóa, để trình đọc màn hình đọc được. Mắt thường thấy nó cạnh nút khi bấm, trỏ chuột hay focus vào nút bị khóa, thay vì lặp ở mọi ghi chú. `ux` chốt cách vẽ trong design.md. AC8 chỉ đòi nút bị khóa có dòng nhắc kèm theo.
4. **E2E trên Development dùng chung trạng thái ghim với người thật.** Nếu có người ghim đủ 3 ghi chú trên Development lúc QA chạy, các test ghim ghi chú thật (AC1–AC7) sẽ fail, vì nút Ghim bị khóa. Đề xuất: chấp nhận rủi ro này. Test chỉ bỏ ghim ghi chú chính nó ghim, không thêm endpoint bỏ mọi ghim chỉ cho test. Khi gặp, bạn bỏ ghim trên Development rồi chạy lại QA.
