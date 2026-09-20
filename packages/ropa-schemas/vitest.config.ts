import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages resolve to their TypeScript sources, so a test runs
  // against the code as written and never against a stale dist/.
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
