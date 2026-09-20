import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { REQUIRED_ENV_VARS } from './config.js';

/**
 * `.env.example` is the only instruction a clone gets. If a phase adds a
 * required variable and forgets the example, the next person's first run fails
 * with a validation error and no hint of what to put there.
 */
const EXAMPLE = readFileSync(
  fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
  'utf8',
);

function declaredInExample(): Set<string> {
  return new Set(
    EXAMPLE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split('=')[0]?.trim() ?? ''),
  );
}

describe('.env.example', () => {
  it('documents every variable the config module requires', () => {
    const documented = declaredInExample();
    const missing = REQUIRED_ENV_VARS.filter((name) => !documented.has(name));
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives each documented variable a value, not a bare name', () => {
    const bare = EXAMPLE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.includes('='));
    expect(bare).toEqual([]);
  });
});
