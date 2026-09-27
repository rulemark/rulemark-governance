import { defineConfig } from 'vitest/config';

/** `npm run test:dist`: the built artifact, started the way Render starts it. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/dist.test.ts'],
  },
});
