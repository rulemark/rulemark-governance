import { createRopaClient, type RopaClient } from '@rulemark/ropa-client';

import { loadConfig } from './config';

/**
 * The server's client: straight to ropa-api, over Render's private network
 * (ropa-packages.md §8.1). Anonymous in interface step 1 (open question 4);
 * step 2 gives it the signed-in user's token. Server code only: the browser
 * has no ROPA_API_URL, and uses `browserRopa`.
 */
export function serverRopa(): RopaClient {
  return createRopaClient({ baseUrl: loadConfig().ropaApiUrl });
}
