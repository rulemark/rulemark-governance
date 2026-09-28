import { afterEach, describe, expect, it, vi } from 'vitest';

import nextConfig from '../../next.config';
import { ConfigError } from './config';
import { ropaRewrites } from './rewrites';

// The browser's way to ropa-api: /api/ropa/v1/... on this app's origin,
// passed through by Next to the API (ropa-packages.md §8.1). A rewrite in
// interface step 1, with no credentials to attach; step 2 decides, with its
// sign-in, whether that stays a rewrite (open question 4).
describe('ropaRewrites', () => {
  it("passes the API's resources through, path and query as they are", () => {
    expect(ropaRewrites({ ROPA_API_URL: 'http://localhost:3000' })).toEqual([
      { source: '/api/ropa/v1/:path*', destination: 'http://localhost:3000/v1/:path*' },
    ]);
  });

  // Render's Blueprint wires the API in as host:port on the private network.
  it('takes the API as host:port, as the Blueprint wires it', () => {
    expect(ropaRewrites({ ROPA_API_URL: 'ropa-api-x1y2:10000' })[0]?.destination).toBe(
      'http://ropa-api-x1y2:10000/v1/:path*',
    );
  });

  // Next compiles rewrites into the build: without the API, the build stops.
  it('refuses to build without the API', () => {
    expect(() => ropaRewrites({})).toThrow(ConfigError);
    expect(() => ropaRewrites({})).toThrow(/ROPA_API_URL/);
  });
});

describe('next.config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites with the environment's API", async () => {
    vi.stubEnv('ROPA_API_URL', 'ropa-api-x1y2:10000');

    expect(await nextConfig.rewrites?.()).toEqual(
      ropaRewrites({ ROPA_API_URL: 'ropa-api-x1y2:10000' }),
    );
  });
});
