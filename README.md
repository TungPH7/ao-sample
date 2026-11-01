# ao-sample

Dự án mẫu cho Pilot 1 của [ai-orchestrator](https://github.com/TungPH7/ai-orchestrator-v1): `apps/web` (Next.js) và `apps/api` (NestJS) trong một npm workspace. Spec của pilot nằm ở `SPEC-pilot-1.md` trong repo kit.

## Chạy ở máy

Cần Node.js 24.

```
npm ci                       # cài hai app và hook git của kit
npm run dev                  # web ở http://localhost:3000, api ở http://localhost:3001
npm run lint                 # ESLint cho web, oxlint cho api
npm run typecheck
npm run test:coverage        # Vitest; ghi apps/web/coverage/lcov.info và apps/api/coverage/lcov.info
npm run build
npm run test:e2e             # Playwright tự chạy hai app
```

Lần đầu chạy E2E trên một máy mới: `npx playwright install chromium`.

## Kit

Thư mục `.ai-orchestrator/`, `.claude/`, `.githooks/`, `.mcp.json`, `.jira/` và các workflow trong `.github/workflows/` là bản chép của kit ai-orchestrator. Đây là đường dẫn được bảo vệ: chỉ sửa qua PR chép kit, và bạn tự merge PR đó.

- Space Jira: `SMP`.
- Nhánh: `feature/<KEY>-<slug>` tách từ `develop`, merge qua PR. `merge-gate` merge PR khi đủ cổng.
- Lệnh của Claude Code: `/ao-status`, `/ao-spec`, `/ao-plan`, `/ao-build`, `/ao-review`, `/ao-fix`. Cách dùng ở `docs/dev-workflow.md` trong repo kit.
