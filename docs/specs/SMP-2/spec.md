# Spec: Ghi chú: tạo và xem danh sách

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2 · **Status:** Draft

## Objective

Người dùng ghi lại nhanh một điều cần nhớ: tạo ghi chú có tiêu đề và nội dung, rồi xem lại các ghi chú đã tạo trong một danh sách. Khi nhập sai, người dùng biết ngay ô nào sai và sai thế nào, ngay cạnh ô đó, không phải đoán.

Đây là Epic thử của Pilot 1: nó đi qua đủ các giai đoạn của quy trình SDLC trên `apps/web` (Next.js) và `apps/api` (NestJS). Ghi chú nằm trong bộ nhớ của API, nên mất khi API khởi động lại; đó là chủ ý của Epic, không phải lỗi.

**Thành công nghĩa là:** người dùng tạo được ghi chú và thấy nó ngay ở đầu danh sách, không tải lại trang; mọi giá trị sai đều bị chặn ở cả form lẫn API, với thông báo hiện cạnh đúng ô.

**Người dùng:** bất kỳ ai mở ứng dụng. Không có đăng nhập, nên mọi người dùng chung một danh sách.

**Màn hình:** Epic có giao diện, nên `ux` vẽ màn hình trong `docs/specs/SMP-2/design.md`, cạnh file này, và trỏ tới các tiêu chí bằng mã `AC<n>` bên dưới.

### Rules

Quy tắc của một ghi chú. Form và API áp dụng cùng một bộ quy tắc, cùng giới hạn và cùng cách đếm.

| Trường | Bắt buộc | Giới hạn | Ghi chú |
|---|---|---|---|
| Tiêu đề | Có | 1–100 ký tự | Bỏ khoảng trắng ở đầu và cuối trước khi kiểm tra và lưu. Tiêu đề chỉ có khoảng trắng coi như trống. Được trùng tiêu đề với ghi chú khác. |
| Nội dung | Không | 0–1000 ký tự | Lưu nguyên như đã nhập, kể cả các lần xuống dòng. |
| Thời gian tạo | Hệ thống tự gán | | Người dùng không nhập. Dùng để sắp xếp danh sách. |

- **Đếm ký tự:** đếm theo ký tự Unicode mà người dùng nhìn thấy sau khi chuẩn hóa NFC, nên một chữ có dấu như "ệ" tính là 1 ký tự, dù gõ bằng bộ gõ nào.
- **Khi nào lỗi hiện** (xem Q4): lỗi quá dài hiện ngay khi giá trị vượt giới hạn trong lúc gõ, và form không chặn gõ thêm; lỗi thiếu tiêu đề hiện khi rời ô Tiêu đề lúc nó trống, hoặc khi bấm Lưu; lỗi biến mất ngay khi giá trị hợp lệ trở lại.
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
- AC11: Given đã tạo ghi chú A rồi tới ghi chú B, When mở hoặc tải lại trang Ghi chú, Then thấy cả hai, B ở trên A, và mỗi ghi chú hiện tiêu đề, nội dung giữ nguyên các lần xuống dòng, và thời gian tạo.
- AC12: Given tiêu đề hoặc nội dung có đoạn như `<b>đậm</b>` hay `<script>alert(1)</script>`, When ghi chú hiện trong danh sách, Then thấy đúng từng ký tự đã nhập, không thành chữ đậm và không chạy mã.
- AC13: Given API không trả được danh sách, When mở trang Ghi chú, Then thấy "Không tải được danh sách ghi chú. Vui lòng thử lại." thay cho danh sách.

### Out of Scope

- Sửa, xóa, tìm kiếm, lọc ghi chú, và trang xem chi tiết một ghi chú.
- Phân trang: danh sách hiện mọi ghi chú.
- Định dạng nội dung (Markdown, chữ đậm, đường link bấm được).
- Lưu bền vững: ghi chú mất khi API khởi động lại.
- Đăng nhập, và ghi chú riêng của từng người.

## Tech Stack

Như README: Next.js 16.4.3 và React 19.3.0 ở `apps/web`, NestJS 12 ở `apps/api`, Vitest 4, Playwright 1.64.1, Node.js 24. Ghi chú lưu trong bộ nhớ của tiến trình API, không có cơ sở dữ liệu. `sa` ghi thêm ở đây thư viện mà Epic cần, kèm phiên bản.

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

Theo đề xuất ở Q2; `sa` chốt trong plan.

```
apps/api/src/notes/          → module notes: controller, service, kho trong bộ nhớ, DTO; unit test *.spec.ts cạnh file
apps/api/test/               → integration test của API: notes.e2e-spec.ts
apps/web/src/app/notes/      → trang Ghi chú (/notes): form tạo và danh sách; test *.test.tsx cạnh file
apps/web/src/app/page.tsx    → trang chủ (/), chuyển tới /notes
e2e/notes/                   → E2E Playwright, một test cho mỗi tiêu chí AC1–AC13
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

- **Unit, viết theo TDD cho mỗi Story** (Vitest): quy tắc kiểm tra tiêu đề và nội dung, gồm các biên 0, 1, 100, 101 và 1000, 1001 ký tự, chữ có dấu, khoảng trắng; kho trong bộ nhớ và thứ tự mới nhất lên đầu. Ở `apps/api/src/**/*.spec.ts` và `apps/web/src/**/*.test.tsx`.
- **Integration, viết theo TDD cho mỗi Story**: API qua supertest ở `apps/api/test/notes.e2e-spec.ts`, cho tạo hợp lệ, từng loại lỗi 400 và danh sách; form và danh sách của web với Testing Library, API được giả lập.
- **E2E** (Playwright, `e2e/notes/`): một test cho mỗi tiêu chí AC1–AC13, tên bắt đầu bằng mã tiêu chí. AC9 gửi yêu cầu thẳng tới API bằng `request`, như `e2e/smoke.spec.ts`.
- **Kho dùng chung khi chạy E2E:** Playwright chạy song song (`fullyParallel`) trên cùng một tiến trình API, nên test không được giả định danh sách trống hay đếm tổng số ghi chú; mỗi test dùng tiêu đề riêng của nó. AC7, AC8, AC10 và AC13 cần kiểm soát được trạng thái hoặc câu trả lời của API; plan của `sa` nói cách làm, trong giới hạn của mục Boundaries.

## Boundaries

- **Always:** API kiểm tra lại mọi quy tắc ở mục Rules, không tin dữ liệu từ form; form và API dùng cùng giới hạn và cùng cách đếm ký tự; hiện tiêu đề và nội dung dưới dạng chữ thuần; gắn mỗi thông báo lỗi với ô của nó để trình đọc màn hình đọc được; mọi chữ trên giao diện bằng tiếng Việt, đúng nguyên văn ở mục Rules.
- **Ask first:** thêm cơ sở dữ liệu hay bất kỳ cách lưu bền vững nào; thêm endpoint chỉ dùng cho test, như xóa toàn bộ ghi chú; đổi giới hạn độ dài hay nội dung thông báo; thêm tính năng ở mục Out of Scope.
- **Never:** đưa tiêu đề hay nội dung vào trang dưới dạng HTML (như `dangerouslySetInnerHTML`); ghi tiêu đề hay nội dung ghi chú vào log; trả stack trace hay chi tiết lỗi nội bộ cho client.

## Success Criteria

- Hai Story trên đạt DoD, và E2E test của từng tiêu chí AC1–AC13 đều pass trên môi trường Development.
- Mọi yêu cầu sai quy tắc ở mục Rules, dù qua form hay gửi thẳng tới API, đều không tạo ra ghi chú.
- Mỗi thông báo lỗi ở mục Rules hiện đúng nguyên văn, đúng chỗ, và được gắn với ô của nó.
- Smoke test sẵn có (`e2e/smoke.spec.ts`) vẫn pass.

## Open Questions

- **Q1: Giới hạn độ dài là bao nhiêu?** Epic nói có giới hạn nhưng không nêu số. Đề xuất: tiêu đề 1–100 ký tự, nội dung 0–1000 ký tự, tức nội dung không bắt buộc. AC4, AC5 và mục Rules viết theo đề xuất này.
- **Q2: Trang Ghi chú nằm ở đâu?** Đề xuất: một trang duy nhất ở `/notes`, form tạo ở trên, danh sách ở dưới; trang chủ `/`, hiện còn là trang mẫu của Next.js, chuyển thẳng tới `/notes`.
- **Q3: Danh sách sắp xếp và hiện những gì?** Đề xuất: mới nhất lên đầu; mỗi ghi chú hiện tiêu đề, toàn bộ nội dung và thời gian tạo dạng `dd/MM/yyyy HH:mm` theo giờ của máy người dùng; hiện tất cả, không phân trang. AC11 viết theo đề xuất này.
- **Q4: "Lỗi hiện ngay cạnh ô nhập" là hiện vào lúc nào?** Đề xuất: lỗi quá dài hiện ngay khi gõ vượt giới hạn, và form không chặn gõ thêm, để người dùng thấy lỗi thay vì bị cắt chữ; lỗi thiếu tiêu đề hiện khi rời ô Tiêu đề hoặc khi bấm Lưu, để không báo lỗi lúc người dùng chưa kịp gõ; lỗi biến mất ngay khi sửa đúng. AC3–AC6 viết theo đề xuất này.
