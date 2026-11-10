# Spec: Ghi chú: tạo và xem danh sách

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2 · **Status:** Approved 2026-11-02

## Objective

Người dùng ghi lại nhanh một điều cần nhớ: tạo ghi chú có tiêu đề và nội dung, rồi xem lại các ghi chú đã tạo trong một danh sách. Khi nhập sai, người dùng biết ngay ô nào sai và sai thế nào, ngay cạnh ô đó, không phải đoán.

Đây là Epic thử của Pilot 1: nó đi qua đủ các giai đoạn của quy trình SDLC trên `apps/web` (Next.js) và `apps/api` (NestJS). Ghi chú nằm trong bộ nhớ của API, nên mất khi API khởi động lại; đó là chủ ý của Epic, không phải lỗi.

**Thành công nghĩa là:** người dùng tạo được ghi chú và thấy nó ngay ở đầu danh sách, không tải lại trang; mọi giá trị sai đều bị chặn ở cả form lẫn API, với thông báo hiện cạnh đúng ô.

**Người dùng:** bất kỳ ai mở ứng dụng. Không có đăng nhập, nên mọi người dùng chung một danh sách.

**Trang:** một trang Ghi chú duy nhất ở `/notes`, form tạo ở trên, danh sách ở dưới. Trang chủ `/`, hiện còn là trang mẫu của Next.js, chuyển thẳng tới `/notes`.

**Màn hình:** Epic có giao diện, nên `ux` vẽ màn hình trong `docs/specs/SMP-2/design.md`, cạnh file này, và trỏ tới các tiêu chí bằng mã `AC<n>` bên dưới.

### Rules

Quy tắc của một ghi chú. Form và API áp dụng cùng một bộ quy tắc, cùng giới hạn và cùng cách đếm. Nội dung không bắt buộc.

| Trường | Bắt buộc | Giới hạn | Ghi chú |
|---|---|---|---|
| Tiêu đề | Có | 1–100 ký tự | Bỏ khoảng trắng ở đầu và cuối trước khi kiểm tra và lưu. Tiêu đề chỉ có khoảng trắng coi như trống. Được trùng tiêu đề với ghi chú khác. |
| Nội dung | Không | 0–1000 ký tự | Lưu nguyên như đã nhập: không bỏ khoảng trắng hay lần xuống dòng nào. Chỉ chuẩn hóa như dưới đây. |
| Thời gian tạo | Hệ thống tự gán | | Người dùng không nhập. Dùng để sắp xếp danh sách. |

- **Chuẩn hóa:** trước khi kiểm tra, form và API chuẩn hóa tiêu đề và nội dung giống nhau, theo thứ tự: đổi sang dạng NFC; đổi mọi `\r\n` và mọi `\r` đứng riêng thành `\n`; với tiêu đề thì bỏ khoảng trắng ở đầu và cuối. API lưu đúng dạng đã chuẩn hóa này. Người dùng không thấy khác biệt, vì dạng trước và sau chuẩn hóa hiện ra như nhau.
- **Đếm ký tự:** đếm số điểm mã Unicode của giá trị đã chuẩn hóa, tức `Array.from(value.normalize('NFC')).length`. Một chữ có dấu như "ệ" tính là 1 ký tự, dù gõ bằng bộ gõ nào, và mỗi lần xuống dòng tính 1 ký tự. Emoji ghép tính nhiều hơn 1 ký tự: 👍🏽 tính 2, 👨‍👩‍👧 tính 5, cờ 🇻🇳 tính 2. Cách đếm này cho cùng kết quả ở mọi trình duyệt và ở Node.js; đếm như mắt thấy bằng `Intl.Segmenter` thì không, vì kết quả của nó tùy phiên bản Unicode của từng nơi.
- **Khi nào lỗi hiện:** lỗi quá dài hiện ngay khi giá trị vượt giới hạn trong lúc gõ, và form không chặn gõ thêm, để người dùng thấy lỗi thay vì bị cắt chữ; lỗi thiếu tiêu đề hiện khi rời ô Tiêu đề lúc nó trống, hoặc khi bấm Lưu, để không báo lỗi lúc người dùng chưa kịp gõ; lỗi biến mất ngay khi giá trị hợp lệ trở lại.
- **Danh sách:** mới nhất lên đầu, theo thời gian tạo. Mỗi ghi chú hiện tiêu đề, toàn bộ nội dung và thời gian tạo dạng `dd/MM/yyyy HH:mm`, theo giờ của máy người dùng. Danh sách hiện mọi ghi chú, không phân trang.
- **Thông báo lỗi**, đúng nguyên văn:

| Trường hợp | Thông báo | Hiện ở |
|---|---|---|
| Tiêu đề trống | Vui lòng nhập tiêu đề | Cạnh ô Tiêu đề |
| Tiêu đề quá 100 ký tự | Tiêu đề tối đa 100 ký tự | Cạnh ô Tiêu đề |
| Nội dung quá 1000 ký tự | Nội dung tối đa 1000 ký tự | Cạnh ô Nội dung |
| API không lưu được | Không lưu được ghi chú. Vui lòng thử lại. | Trên nút Lưu, chung cho cả form |
| API không trả được danh sách | Không tải được danh sách ghi chú. Vui lòng thử lại. | Thay cho danh sách |
| Chưa có ghi chú nào | Chưa có ghi chú nào. | Thay cho danh sách |

### User Stories

**Story: Tạo ghi chú.** Là người dùng, tôi muốn tạo một ghi chú có tiêu đề và nội dung để lưu lại điều mình cần nhớ.

- AC1: Given đang ở trang Ghi chú, When nhập tiêu đề "Mua sữa" và nội dung "2 hộp" rồi bấm Lưu, Then ghi chú "Mua sữa" hiện ở đầu danh sách với nội dung "2 hộp", và hai ô nhập trống lại, không cần tải lại trang.
- AC2: Given đã nhập tiêu đề và để trống nội dung, When bấm Lưu, Then ghi chú được tạo với nội dung trống và hiện ở đầu danh sách.
- AC3: Given ô Tiêu đề trống hoặc chỉ có khoảng trắng, When bấm Lưu hoặc rời ô Tiêu đề, Then thấy "Vui lòng nhập tiêu đề" ngay cạnh ô Tiêu đề, và không có ghi chú nào được tạo; nếu đã bấm Lưu, con trỏ chuyển vào ô Tiêu đề.
- AC4: Given đang gõ ô Tiêu đề, When tiêu đề dài 101 ký tự, Then thấy "Tiêu đề tối đa 100 ký tự" ngay cạnh ô Tiêu đề, và bấm Lưu không tạo ghi chú; còn tiêu đề đúng 100 ký tự, kể cả chữ có dấu, thì lưu được.
- AC5: Given đang gõ ô Nội dung, When nội dung dài 1001 ký tự, Then thấy "Nội dung tối đa 1000 ký tự" ngay cạnh ô Nội dung, và bấm Lưu không tạo ghi chú; còn nội dung đúng 1000 ký tự thì lưu được.
- AC6: Given một ô đang hiện lỗi, When sửa giá trị của ô đó cho hợp lệ, Then lỗi của ô đó biến mất ngay, không cần bấm Lưu.
- AC7: Given đã bấm Lưu với dữ liệu hợp lệ và API chưa trả lời, When bấm Lưu thêm lần nữa, Then chỉ một ghi chú được tạo.
- AC8: Given API không lưu được ghi chú, do lỗi mạng hoặc lỗi máy chủ, When bấm Lưu, Then thấy "Không lưu được ghi chú. Vui lòng thử lại.", và tiêu đề, nội dung đã nhập vẫn còn nguyên trong form.
- AC9: Given một yêu cầu tạo ghi chú gửi thẳng tới API, không qua form, có tiêu đề trống, tiêu đề quá 100 ký tự hoặc nội dung quá 1000 ký tự, When API nhận yêu cầu, Then API trả lỗi 400 nêu từng trường sai, và không ghi chú nào được lưu.

**Story: Xem danh sách ghi chú.** Là người dùng, tôi muốn xem danh sách các ghi chú đã tạo để đọc lại chúng.

- AC10: Given chưa có ghi chú nào, When mở trang Ghi chú, Then thấy "Chưa có ghi chú nào." thay cho danh sách.
- AC11: Given đã tạo ghi chú A rồi tới ghi chú B, When mở hoặc tải lại trang Ghi chú, Then thấy cả hai, B ở trên A, và mỗi ghi chú hiện tiêu đề, nội dung giữ nguyên các lần xuống dòng, và thời gian tạo dạng `dd/MM/yyyy HH:mm` theo giờ của máy người dùng.
- AC12: Given tiêu đề hoặc nội dung có đoạn như `<b>đậm</b>` hay `<script>alert(1)</script>`, When ghi chú hiện trong danh sách, Then thấy đúng từng ký tự đã nhập, không thành chữ đậm và không chạy mã.
- AC13: Given API không trả được danh sách, When mở trang Ghi chú, Then thấy "Không tải được danh sách ghi chú. Vui lòng thử lại." thay cho danh sách.

**Story: Giới hạn số ghi chú.** Là người dùng, tôi muốn ứng dụng giữ tối đa 1000 ghi chú để ứng dụng vẫn chạy và tôi vẫn đọc được các ghi chú đã có, kể cả khi có người tạo rất nhiều ghi chú.

- AC14: Given kho đã có 1000 ghi chú, When nhập một ghi chú hợp lệ rồi bấm Lưu, Then không có ghi chú nào được lưu, thấy "Không lưu được ghi chú. Vui lòng thử lại." như AC8, và tiêu đề, nội dung đã nhập vẫn còn nguyên trong form.
- AC15: Given kho đã có 1000 ghi chú và một lần lưu vừa bị từ chối như AC14, When mở hoặc tải lại trang Ghi chú, Then thấy đủ 1000 ghi chú, mới nhất ở đầu, và không có ghi chú vừa bị từ chối.

### Out of Scope

- Sửa, xóa, tìm kiếm, lọc ghi chú, và trang xem chi tiết một ghi chú.
- Phân trang: danh sách hiện mọi ghi chú.
- Định dạng nội dung (Markdown, chữ đậm, đường link bấm được).
- Lưu bền vững: ghi chú mất khi API khởi động lại.
- Đăng nhập, và ghi chú riêng của từng người.

### Non-functional requirements

**Phạm vi chạy.** Ứng dụng chạy ở máy dev, trong CI, và từ SMP-17 trên VPS ở ba môi trường Development, Staging và Production, do deployer của kit build và chạy. Chỉ web ra Internet; API nằm trong mạng nội bộ của môi trường, nhưng ai mở được web cũng gọi được API qua đường `/api/notes` của web. Development và Staging đòi một tài khoản basic auth dùng chung; Production công khai, ai cũng mở được mà không cần đăng nhập. Mỗi lần deploy chạy một API mới với kho rỗng, nên ghi chú của môi trường đó mất, như khi API khởi động lại. Các giới hạn dưới đây đặt theo phạm vi đó: kho giữ tối đa 1000 ghi chú (AC14, AC15), để không ai làm hết bộ nhớ của VPS dùng chung. Giới hạn tần suất, header bảo mật và lưu bền vững chưa có; chúng thuộc Epic SMP-19. Rủi ro còn lại cho tới khi đó nằm ở mục Bảo mật.

**Hiệu năng.** Khối lượng tính toán là tối đa 1000 ghi chú, mỗi ghi chú dài tới giới hạn của mục Rules.

| Chỉ số | Mục tiêu | Kiểm bằng |
|---|---|---|
| Thời gian API trả lời `POST` và `GET` ghi chú, khi kho có 1000 ghi chú dài tối đa | ≤ 200 ms ở p95 trên máy dev, không tính mạng | Integration test nạp 1000 ghi chú rồi gọi `GET`. Ngưỡng của test nới ra 1 s để không chập chờn trên CI, vẫn đủ bắt lỗi chậm theo bình phương |
| Từ lúc bấm Lưu tới lúc ghi chú mới hiện ở đầu danh sách | ≤ 1 s, khi web và API chạy cùng máy | Đo tay một lần bằng DevTools; E2E AC1 kiểm là không tải lại trang |
| Mở trang tới lúc thấy đủ 1000 ghi chú | ≤ 2 s với bản build production (`npm run build` rồi `next start`), cùng máy | Đo tay một lần trước khi Story Xem danh sách vào review |
| Lỗi kiểm tra hiện hay mất sau một phím gõ | Ngay trong lần vẽ của phím đó, không debounce, kể cả khi ô dài 1001 ký tự | Unit test của form |
| Số yêu cầu tới API | Mỗi lần lưu đúng 1 `POST`; mở trang đúng 1 `GET`; lưu thành công thì không tải lại danh sách, trừ khi danh sách đang hiện lỗi tải (xem Open Questions của design.md) | Integration test của web, API được giả lập |
| Thời gian web chờ một yêu cầu | Tối đa 10 s. Quá thời gian thì tính là lỗi: lưu thì hiện lỗi lưu (AC8) và giữ nguyên dữ liệu trong form, tải danh sách thì hiện lỗi tải (AC13) | Integration test của web dùng đồng hồ giả |

**Bảo mật.** Không có đăng nhập và mọi người dùng chung một danh sách, nên ai gọi được API cũng tạo và đọc được mọi ghi chú. Đó là chủ ý của Epic (mục Out of Scope). Các rủi ro còn lại: XSS lưu trữ, tức nội dung một người gõ chạy thành mã trên trang của người khác; dữ liệu sai lọt qua API; dữ liệu lộ ra qua log hay thông báo lỗi.

- **XSS:** tiêu đề, nội dung và thời gian tạo chỉ vào trang dưới dạng chữ hoặc giá trị thuộc tính do React gán, nên React tự escape (AC12). Code của Epic không dùng `dangerouslySetInnerHTML`, `innerHTML` hay `eval`, và không biến chữ trong ghi chú thành đường link.
- **Kiểm tra ở biên API:** thân yêu cầu `POST` phải là một object JSON; `title` phải là chuỗi; `content` là chuỗi hoặc không có. Sai kiểu (số, `null`, mảng, object) cũng trả 400 nêu trường đó, như khi giá trị sai quy tắc. API chỉ đọc `title` và `content`; trường khác như `id`, `createdAt` hay `__proto__` bị bỏ qua, không được lưu, vì `id` và thời gian tạo do API gán.
- **Chỉ nhận JSON:** `POST` chỉ nhận `Content-Type: application/json`; thân dạng khác bị từ chối và không tạo ghi chú. Mặc định Nest còn đọc cả `application/x-www-form-urlencoded`, nên một form HTML ở trang khác gửi được tới API mà không cần CORS.
- **Kích thước:** giữ giới hạn mặc định 100 kB cho thân yêu cầu; vượt quá thì nhận 413 và không ghi chú nào được tạo.
- **Lỗi trả về:** mọi lỗi có cùng một dạng JSON. Lỗi 400 nêu từng trường sai bằng mã máy đọc được và không lặp lại giá trị đã gửi. Lỗi 500 chỉ có một thông báo chung, không có stack trace. JSON hỏng trả 400 với thông báo cố định: hiện Nest trả nguyên câu lỗi của `JSON.parse`, kèm một đoạn thân yêu cầu (đã thử trên `apps/api`).
- **Log:** không ghi tiêu đề, nội dung hay thân yêu cầu vào log (mục Boundaries). Nếu có log yêu cầu, nó chỉ gồm method, đường dẫn, mã trạng thái và thời gian xử lý. Lỗi 500 được ghi stack vào log của máy chủ, nhưng không kèm thân yêu cầu.
- **CORS:** không mở cho mọi origin (`*`). Nếu trình duyệt gọi thẳng API thì chỉ mở cho origin của web, đọc từ biến môi trường, mặc định `http://localhost:3000`. Plan chọn giữa gọi thẳng API và đi qua máy chủ web.
- **Không làm trong Epic này:** giới hạn tần suất và header bảo mật (CSP, helmet); cả hai thuộc Epic SMP-19, cùng với lưu bền vững. Giới hạn số ghi chú thì đã có: kho giữ tối đa 1000 ghi chú (AC14, AC15). Lớp chống XSS chính là việc React escape chữ.
- **Rủi ro còn lại cho tới SMP-19:** Production không có đăng nhập hay giới hạn tần suất, nên bất kỳ ai cũng lấp đầy được kho bằng 1000 lần lưu, trong chưa tới một phút. Từ đó không ai tạo được ghi chú nữa: form hiện lỗi lưu của AC8, nhưng thử lại không bao giờ thành công. Kho không có cách xóa ghi chú, nên cách gỡ duy nhất là khởi động lại API, và việc đó làm mất mọi ghi chú.

**Dữ liệu và thời gian lưu.**

- **Nơi lưu:** ghi chú nằm trong bộ nhớ của một tiến trình API duy nhất. Không chạy nhiều bản API, vì mỗi bản sẽ có một danh sách riêng.
- **Thời gian lưu:** từ lúc tạo tới khi tiến trình API dừng hoặc khởi động lại, kể cả khi `npm run dev` tự khởi động lại API mỗi lần sửa code. Không có sao lưu, xuất dữ liệu hay xóa từng ghi chú. Web không lưu ghi chú ở trình duyệt (localStorage, IndexedDB, cookie, service worker), nên dữ liệu mất cùng lúc với API.
- **Không cache:** câu trả lời `GET` có `Cache-Control: no-store`, và web không cache danh sách (không `use cache`, không cache của `fetch`, dù `next.config.ts` bật `cacheComponents`). Nhờ vậy mở hay tải lại trang luôn thấy ghi chú mới nhất (AC11).
- **Dữ liệu cá nhân:** ứng dụng không thu thập gì về người dùng: không tài khoản, không cookie, không analytics, không lưu địa chỉ IP. Ghi chú hiện cho mọi người mở ứng dụng; người dùng có thể tự gõ thông tin cá nhân vào đó, và thông tin này mất khi API khởi động lại. Không gửi ghi chú cho dịch vụ bên ngoài nào.
- **Một ghi chú gồm:** `id` là chuỗi duy nhất do API sinh; `title` là tiêu đề đã bỏ khoảng trắng ở đầu và cuối; `content` là nội dung, bằng `""` khi không gửi; `createdAt` là thời điểm API nhận yêu cầu, theo đồng hồ của máy chủ API, gửi dạng ISO 8601 UTC có mili giây (`2026-11-02T07:40:00.000Z`).
- **Khoảng trắng** bị bỏ ở tiêu đề là khoảng trắng theo `String.prototype.trim` của JavaScript: dấu cách, tab, xuống dòng và khoảng trắng Unicode như NBSP. Ký tự vô hình không phải khoảng trắng, như U+200B, thì không bị bỏ. Form và API dùng cùng định nghĩa này.
- **Chuẩn hóa và đếm ký tự:** theo mục Rules. Form và API dùng cùng một hàm chuẩn hóa và đếm (xem Tech Stack). Ghi chú mà `POST` và `GET` trả về mang giá trị đã chuẩn hóa, đúng như được lưu.
- **Thứ tự:** mới nhất trước, theo thứ tự API nhận yêu cầu. Hai ghi chú tạo trong cùng một mili giây vẫn đúng thứ tự tạo, nên không chỉ sắp theo `createdAt`.
- **Thời gian tạo trên trang:** web đổi `createdAt` sang giờ của máy người dùng và hiện dạng `dd/MM/yyyy HH:mm`, 24 giờ. Việc đổi giờ chạy ở trình duyệt, không ở máy chủ web, để giờ hiện theo múi giờ của người dùng.
- **Gửi lại:** `POST` không idempotent: gửi lại là tạo thêm một ghi chú. Form chặn gửi đôi trong lúc chờ (AC7) và không tự gửi lại khi lỗi. Một rủi ro được chấp nhận trong Epic này: mạng đứt sau khi API đã lưu, người dùng thấy lỗi lưu, bấm Lưu lại, và có hai ghi chú giống nhau. Epic không dùng `Idempotency-Key`, vì không có chỗ nào tự gửi lại yêu cầu.
- **Bộ nhớ:** kho giữ tối đa 1000 ghi chú, một hằng số có tên trong code của API. Ghi chú thứ 1000 vẫn được lưu; khi kho đã đủ 1000 thì `POST` không lưu gì và trả lỗi 409 với mã `NOTES_LIMIT_REACHED` (AC14), còn `GET` vẫn trả đủ 1000 ghi chú (AC15). Kho không xóa hay đẩy ghi chú cũ ra; nó chỉ trống lại khi API khởi động lại. 1000 ghi chú dài tối đa chiếm khoảng 5 MB, nên kho đầy không làm hết bộ nhớ của VPS dùng chung.

## Tech Stack

Như README: Next.js 16.4.3 và React 19.3.0 ở `apps/web`, NestJS 12 (bản cài 12.3.2) ở `apps/api`, Vitest 4, Playwright 1.64.1, Node.js 24. Ghi chú lưu trong bộ nhớ của tiến trình API, không có cơ sở dữ liệu.

Epic không thêm thư viện npm nào, ở cả hai app lẫn ở gốc. Những thứ có sẵn mà Epic dùng và README chưa nêu:

| Dùng | Phiên bản | Để làm gì |
|---|---|---|
| `String.prototype.normalize('NFC')`, `Array.from` | Có sẵn trong Node.js 24 và trình duyệt | Chuẩn hóa và đếm ký tự theo mục Rules, cùng một cách ở form và API |
| `crypto.randomUUID()` | Node.js 24 (bản cài 24.17.0) | Sinh `id` của ghi chú |
| `Date` của trình duyệt (`getDate`, `getHours`…) | Có sẵn | Ghép tay thời gian tạo thành `dd/MM/yyyy HH:mm` theo giờ của máy người dùng. Không dùng `toLocaleString` hay `Intl.DateTimeFormat('vi-VN')`, vì thứ tự ngày giờ của chúng tùy locale và phiên bản ICU |
| Body parser JSON của `@nestjs/platform-express` | 12.3.2, trên Express 5.3.0 | Đọc thân yêu cầu, giữ giới hạn mặc định 100 kB |

Epic không dùng `class-validator`, `class-transformer` hay Zod. Quy tắc chỉ có hai trường, và các thư viện đó đếm độ dài trên chuỗi chưa chuẩn hóa NFC (`.max()` của Zod còn đếm theo đơn vị UTF-16). Vì vậy một hàm kiểm tra thuần, viết tay, gọn hơn và dùng được ở cả hai app. Plan chốt cách hai app dùng chung hàm đó trong cấu trúc của mục Project Structure, không thêm workspace mới.

## Commands

Không đổi so với README:

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

Trang Ghi chú ở `/notes`, trang chủ chuyển tới đó; `sa` chốt tên file trong plan.

```
apps/api/src/notes/          → module notes: controller, service, kho trong bộ nhớ, DTO; unit test *.spec.ts cạnh file
apps/api/test/               → integration test của API: notes.e2e-spec.ts
apps/web/src/app/notes/      → trang Ghi chú (/notes): form tạo và danh sách; test *.test.tsx cạnh file
apps/web/src/app/page.tsx    → trang chủ (/), chuyển tới /notes
e2e/notes/                   → E2E Playwright, một test cho mỗi tiêu chí AC1–AC15
docs/specs/SMP-2/            → spec.md, design.md, plan.md của Epic
```

## Code Style

Như cấu hình sẵn có: Prettier với nháy đơn và dấu phẩy cuối ở `apps/api`, ESLint của Next ở `apps/web`, oxlint ở `apps/api`. Hai quy ước Epic này phải theo:

`apps/api` là ES module, nên import nội bộ kết thúc bằng `.js`:

```ts
import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller.js';
```

Tên mỗi E2E test bắt đầu bằng mã tiêu chí mà nó kiểm:

```ts
test('AC3 shows an error next to the title when it is empty', async ({ page }) => {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('textbox', { name: 'Tiêu đề' })).toHaveAccessibleDescription('Vui lòng nhập tiêu đề');
});
```

## Testing Strategy

- **Unit, viết theo TDD cho mỗi Story** (Vitest): quy tắc kiểm tra tiêu đề và nội dung, gồm các biên 0, 1, 100, 101 và 1000, 1001 ký tự, chữ có dấu (cả khi gõ ở dạng NFD), khoảng trắng, emoji ghép (👍🏽 tính 2 ký tự), xuống dòng `\r\n` và `\r` (tính 1 ký tự và được lưu thành `\n`); kho trong bộ nhớ và thứ tự mới nhất lên đầu. Ở `apps/api/src/**/*.spec.ts` và `apps/web/src/**/*.test.tsx`.
- **Integration, viết theo TDD cho mỗi Story**: API qua supertest ở `apps/api/test/notes.e2e-spec.ts`, cho tạo hợp lệ, từng loại lỗi 400 và danh sách, và cho việc API lưu giá trị đã chuẩn hóa (gửi NFD và `\r\n`, nhận lại NFC và `\n`); form và danh sách của web với Testing Library, API được giả lập.
- **E2E** (Playwright, `e2e/notes/`): một test cho mỗi tiêu chí AC1–AC15, tên bắt đầu bằng mã tiêu chí. AC9 gửi yêu cầu thẳng tới API bằng `request`, như `e2e/smoke.spec.ts`.
- **Kho dùng chung khi chạy E2E:** Playwright chạy song song (`fullyParallel`) trên cùng một tiến trình API, nên test không được giả định danh sách trống hay đếm tổng số ghi chú; mỗi test dùng tiêu đề riêng của nó. AC7, AC8, AC10 và AC13 cần kiểm soát được trạng thái hoặc câu trả lời của API; plan của `sa` nói cách làm, trong giới hạn của mục Boundaries.

## Boundaries

- **Always:** API kiểm tra lại mọi quy tắc ở mục Rules, không tin dữ liệu từ form; form và API dùng cùng giới hạn và cùng cách đếm ký tự; hiện tiêu đề và nội dung dưới dạng chữ thuần; gắn mỗi thông báo lỗi với ô của nó để trình đọc màn hình đọc được; mọi chữ trên giao diện bằng tiếng Việt, đúng nguyên văn ở mục Rules.
- **Ask first:** thêm cơ sở dữ liệu hay bất kỳ cách lưu bền vững nào; thêm endpoint chỉ dùng cho test, như xóa toàn bộ ghi chú; đổi giới hạn độ dài hay nội dung thông báo; thêm tính năng ở mục Out of Scope.
- **Never:** đưa tiêu đề hay nội dung vào trang dưới dạng HTML (như `dangerouslySetInnerHTML`); ghi tiêu đề hay nội dung ghi chú vào log; trả stack trace hay chi tiết lỗi nội bộ cho client.

## Success Criteria

- Ba Story trên đạt DoD, và E2E test của từng tiêu chí AC1–AC15 đều pass trên môi trường Development.
- Mọi yêu cầu sai quy tắc ở mục Rules, dù qua form hay gửi thẳng tới API, đều không tạo ra ghi chú.
- Mỗi thông báo lỗi ở mục Rules hiện đúng nguyên văn, đúng chỗ, và được gắn với ô của nó.
- Smoke test sẵn có (`e2e/smoke.spec.ts`) vẫn pass.

## Open Questions

Không có.
