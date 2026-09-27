import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Next serves src/app/icon.svg as the favicon; it has to live in the app, so
// it's a copy of the brand's icon, and this keeps the two the same.
describe('the favicon', () => {
  it("is the brand's icon", async () => {
    const brand = createRequire(import.meta.url).resolve('@rulemark/ui/brand/rulemark-icon.svg');

    expect(await readFile(new URL('./icon.svg', import.meta.url), 'utf8')).toBe(
      await readFile(brand, 'utf8'),
    );
  });
});
