# ADR-0001: Web dùng chung quy tắc và kiểu của ghi chú bằng cách import một file nguồn của API

> **Epic:** SMP-2 · **Jira:** https://phunghuutung12b4.atlassian.net/browse/SMP-2

## Status

Proposed with the plan of SMP-2; it takes effect when you approve the plan at gate ②

## Date

2026-11-02

## Context

SPEC của SMP-2 (mục Rules và Tech Stack) đòi form ở `apps/web` và API ở `apps/api` chuẩn hóa, đếm ký tự và kiểm tra tiêu đề, nội dung bằng **cùng một hàm**, để hai bên không bao giờ đếm khác nhau ở giới hạn 100 và 1000 ký tự. SPEC cũng chặn hai cách làm dễ thấy: không thêm thư viện npm, và không thêm workspace mới. Plan còn cần một nơi cho kiểu của hợp đồng API (`Note`, `CreateNoteInput`), để web và API lệch nhau thì `npm run typecheck` báo lỗi.

Ràng buộc của repo:

- `apps/api` là ES module, `moduleResolution: nodenext`, và `nest build` dùng `tsconfig.build.json` với `rootDir: ./src`: mọi file nó biên dịch phải nằm trong `apps/api/src`.
- `apps/web` dùng `moduleResolution: bundler`, Turbopack của Next.js 16.4.3 và Vitest 4. Turbopack chỉ đọc file nằm trong thư mục gốc của nó. Next.js tìm thư mục gốc theo `package-lock.json`, nên ở repo này gốc là thư mục gốc của repo, không phải `apps/web`.

## Decision

Kiểu và quy tắc của ghi chú nằm trong một file duy nhất, `apps/api/src/notes/notes.shared.ts`. Web import file đó qua alias `@api/notes-shared` khai báo trong `paths` của `apps/web/tsconfig.json`, và alias trỏ đúng tới file này, không tới cả thư mục.

File này là một file lá: không import gì, không dùng decorator, không dùng API chỉ có ở Node.js hay chỉ có ở trình duyệt. Nó chỉ dùng cú pháp và hàm có sẵn ở cả hai nơi, như `String.prototype.normalize` và `Array.from`.

## Alternatives Considered

### Một package mới trong npm workspace (`packages/notes-shared`)
- Pros: ranh giới rõ, cách làm quen thuộc của monorepo.
- Cons: SPEC không cho thêm workspace trong Epic này. Package còn cần bước build, hoặc cấu hình `exports` trỏ thẳng vào mã TypeScript, cho cả `nodenext` của API lẫn Turbopack.
- Rejected: trái SPEC, và nặng hơn nhu cầu của một file.

### Đặt file ở web, API import sang
- Pros: không có.
- Cons: `nest build` từ chối file nằm ngoài `rootDir: ./src`. Muốn nới `rootDir` thì cấu trúc `dist/` đổi thành `dist/src/main.js`, và `start:prod` cùng `nest start` hỏng.
- Rejected: phải đổi cách build của API.

### Thư mục `shared/` ở gốc repo, không phải workspace
- Pros: không thuộc riêng app nào.
- Cons: vướng `rootDir` của API như cách trên.
- Rejected: cùng lý do.

### Hai bản sao, ở web và ở API, chạy chung một bộ ca kiểm thử
- Pros: mỗi app tự đủ, không phụ thuộc chéo.
- Cons: hai bản sao sẽ lệch nhau theo thời gian, đúng lỗi mà SPEC muốn tránh. Bộ ca chung chỉ bắt được lệch ở những ca đã viết.
- Rejected: SPEC đòi một hàm.

## Consequences

- Đã thử trên một bản chép của `apps/web` (spike, không commit): `tsc --noEmit` với TypeScript 5 của web, Vitest với `resolve.tsconfigPaths` và `next build` bằng Turbopack đều đọc được file qua alias, và `/notes` vẫn là trang tĩnh.
- Sửa `notes.shared.ts` là sửa cả hai app. `npm run typecheck`, `npm run build` và `npm run test:coverage` ở gốc chạy cho cả hai workspace, nên lỗi ở phía web vẫn hiện ra trong CI.
- oxlint và unit test của API phủ file này; ESLint của web không lint nó.
- Web không được import thứ gì khác của API. Alias chỉ trỏ tới một file, nên muốn dùng thêm file nào thì phải sửa alias, và reviewer thấy điều đó trong diff.
- Nếu sau này có `package-lock.json` riêng trong `apps/web`, thư mục gốc của Turbopack sẽ đổi và import này hỏng. Khi đó đặt `turbopack.root` về gốc repo trong `next.config.ts`.
- Nếu sau này cần một package dùng chung thật, chỉ phải chuyển một file và sửa alias cùng các import trong `apps/api/src/notes/`.
