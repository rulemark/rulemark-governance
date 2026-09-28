import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRootEnvFile } from './root-env';

// The repository-root `.env` in development, as the API reads it (Next reads
// only the app directory's own files, and caches those before
// next.config.ts runs).
describe('loadRootEnvFile', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'root-env-'));
    file = join(dir, '.env');
    await writeFile(file, 'ROPA_API_URL=http://localhost:3000\nPORT=3000\n# a comment\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fills in what the environment lacks', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'development' };

    loadRootEnvFile(file, env);

    expect(env).toMatchObject({ ROPA_API_URL: 'http://localhost:3000', PORT: '3000' });
  });

  it('never overrides what the environment already sets', () => {
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'development',
      ROPA_API_URL: 'http://elsewhere:4000',
    };

    loadRootEnvFile(file, env);

    expect(env['ROPA_API_URL']).toBe('http://elsewhere:4000');
  });

  // A local `next build` or `next typegen` runs as production and needs the
  // API's address for the rewrite. The file is never deployed (.env is
  // gitignored), so on Render and in CI there's nothing to read.
  it('reads it for a local production build too', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'production' };

    loadRootEnvFile(file, env);

    expect(env['ROPA_API_URL']).toBe('http://localhost:3000');
  });

  it('is fine without a file', () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'development' };

    expect(() => loadRootEnvFile(join(dir, 'missing.env'), env)).not.toThrow();
    expect(env['ROPA_API_URL']).toBeUndefined();
  });
});
