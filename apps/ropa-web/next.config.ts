import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

import { loadRootEnvFile } from './src/lib/root-env';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Local development reads the repository-root `.env`, as the API does.
loadRootEnvFile(`${root}.env`);

const nextConfig: NextConfig = {
  // @rulemark/ui ships TypeScript sources; Next compiles them with the app.
  transpilePackages: ['@rulemark/ui'],
  // One lockfile, at the root of the npm workspace.
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
