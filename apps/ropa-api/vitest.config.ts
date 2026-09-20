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
    // One database is shared by every file, and some of these tests commit.
    // Run files one at a time rather than reasoning about which committed row
    // can collide with which uncommitted one — `party_one_self` alone makes
    // that a losing game. The whole suite takes a couple of seconds.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points run in a child process (the bootstrap, the migrator, the
      // openapi writer), so v8 sees none of their lines even though they are
      // covered by test/bootstrap.test.ts, test/dist.test.ts and the global
      // setup. Counting them as untested would be worse than leaving them out.
      exclude: ['src/index.ts', 'src/db/migrate.ts', 'src/api/openapi/write.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
