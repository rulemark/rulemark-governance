import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

import { ropaRewrites } from './src/lib/rewrites';
import { loadRootEnvFile } from './src/lib/root-env';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Locally, the repository-root `.env`, as the API reads it (never deployed).
loadRootEnvFile(`${root}.env`);

const nextConfig: NextConfig = {
  // @rulemark/ui ships TypeScript sources; Next compiles them with the app.
  transpilePackages: ['@rulemark/ui'],
  // One lockfile, at the root of the npm workspace.
  turbopack: { root },
  outputFileTracingRoot: root,
  // The browser reaches ropa-api through this app's origin (/api/ropa/v1/...).
  rewrites: async () => ropaRewrites(),
};

export default nextConfig;
