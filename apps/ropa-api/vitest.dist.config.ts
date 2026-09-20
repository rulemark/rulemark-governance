import { defineConfig } from 'vitest/config';

/**
 * The built artifact only: these tests need `npm run build` to have run, so they
 * are kept out of the default suite and given their own script (`test:dist`).
 * No `development` condition here on purpose — the point is to exercise the same
 * resolution Render gets.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/dist.test.ts'],
  },
});
