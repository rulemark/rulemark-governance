import { describe, expect, it } from 'vitest';

import { GET, dynamic } from './route';

// Render's health check, as the API's: is this process serving?
describe('GET /healthz', () => {
  it('answers 200 with its status and uptime', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(Number.isInteger(body.uptime)).toBe(true);
  });

  it('is never cached or prerendered', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(GET().headers.get('cache-control')).toBe('no-store');
  });
});
