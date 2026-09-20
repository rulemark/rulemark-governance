import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages resolve to their TypeScript sources, so a test runs
  // against the code as written and never against a stale dist/.
  resolve: { conditions: ['development'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/bootstrap.test.ts', 'test/db/**/*.test.ts'],
    restoreMocks: true,
    // Applies the migrations once for the whole run.
    globalSetup: ['test/db/global-setup.ts'],
  },
});
