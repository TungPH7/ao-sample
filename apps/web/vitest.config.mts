import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Set up as node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md says. Vite 8 resolves the tsconfig paths
// itself, so vite-tsconfig-paths is not needed.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    // next.config.test.ts checks the rewrite target (ADR-0002).
    include: ['src/**/*.test.{ts,tsx}', 'next.config.test.ts'],
    coverage: {
      provider: 'v8',
      // lcovonly writes coverage/lcov.info, which the CI of ai-orchestrator reads.
      reporter: ['lcovonly', 'text-summary'],
      // Every source file counts, even one that no test imports yet.
      include: ['src/**/*.{ts,tsx}'],
    },
  },
});
