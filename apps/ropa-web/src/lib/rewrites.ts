import { loadConfig } from './config';

/** One of Next's rewrite rules: requests matching `source` are served from `destination`. */
export interface Rewrite {
  source: string;
  destination: string;
}

/**
 * The browser's way to ropa-api (ropa-packages.md §8.1): /api/ropa/v1/... on
 * this app's origin, which Next passes through to the API, so there's no
 * CORS. Only the API's resources: its health check and docs aren't under
 * /v1. Next compiles rewrites into the build, so the API's address is the
 * one `next build` sees, and a build without it stops here, naming it.
 */
export function ropaRewrites(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Rewrite[] {
  const { ropaApiUrl } = loadConfig(env);
  return [{ source: '/api/ropa/v1/:path*', destination: `${ropaApiUrl}/v1/:path*` }];
}
