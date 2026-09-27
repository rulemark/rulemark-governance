import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DIST_ARGS, DIST_ENTRY } from './process.js';
import { startupTests } from './start.js';

/** The artifact Render runs. Needs a build first: `npm run test:dist` from the root. */
describe('the built receiver', () => {
  it('has been built', () => {
    expect(existsSync(DIST_ENTRY), `${DIST_ENTRY} is missing. Run "npm run build" first.`).toBe(
      true,
    );
  });

  startupTests(DIST_ARGS);
});
