import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    // Two projects, so `vitest run --coverage` runs both and writes one lcov
    // that counts the lines the integration tests cover too.
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['test/**/*.e2e-spec.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      // lcovonly writes coverage/lcov.info, which the CI of ai-orchestrator reads.
      reporter: ['lcovonly', 'text-summary'],
      // Every source file counts, even one that no test imports yet.
      include: ['src/**/*.ts'],
    },
  },
});
