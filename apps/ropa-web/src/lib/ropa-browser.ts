import { createRopaClient } from '@rulemark/ropa-client';

/**
 * The browser's client: this app's own origin, through the proxy at
 * /api/ropa, with no token (the proxy holds any, ropa-packages.md §8.1).
 */
export const browserRopa = createRopaClient({ baseUrl: '/api/ropa' });
