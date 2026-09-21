import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../shared/config.js';
import { createApp } from './app.js';

/**
 * How many proxies to trust, decided by evidence rather than by guessing.
 *
 * `req.ip` is what the token rate limiter keys on. Trusting too few hops makes
 * it an edge node's address, so every caller behind that edge shares one
 * bucket; trusting too many lets a caller pick their own address by sending a
 * forwarding header, which is the vulnerability `trust proxy: true` has.
 *
 * A real request to the deployed service arrives as:
 *
 *   remoteAddress    Render's internal proxy
 *   x-forwarded-for  <caller>, <Cloudflare edge>
 *
 * so there are two hops in front of the application, not the one it trusted
 * until now. These pin that, and prove the setting still resists a caller who
 * prepends an address of their own.
 */
const config = loadConfig({
  LOG_LEVEL: 'info',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://ropa:ropa@localhost:5432/ropa',
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([{ sub: 'reader', name: 'A Reader', roles: ['viewer'] }]),
});

const CALLER = '203.0.113.5';
const EDGE = '198.51.100.7';

/** Reads back what `trust proxy` concluded, from the request log. */
async function clientSeenBy(forwardedFor: string): Promise<{ ip: string; ips: string[] }> {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );

  await request(createApp({ config, logger })).get('/v1/me').set('X-Forwarded-For', forwardedFor);

  const entry = lines.find((line) => line['req'] !== undefined);
  return entry?.['client'] as { ip: string; ips: string[] };
}

describe('trust proxy', () => {
  it('sees the caller, not the edge that forwarded for them', async () => {
    // supertest's own connection is the first hop, standing in for Render's
    // internal proxy; the edge is the second.
    const client = await clientSeenBy(`${CALLER}, ${EDGE}`);
    expect(client.ip).toBe(CALLER);
  });

  it('ignores an address a caller prepends for themselves', async () => {
    // Cloudflare appends the address it observed, so a forged entry ends up to
    // the left of the real one and outside the trusted hops.
    const client = await clientSeenBy(`192.0.2.66, ${CALLER}, ${EDGE}`);
    expect(client.ip).toBe(CALLER);
    expect(client.ip).not.toBe('192.0.2.66');
  });

  it('falls back to the connection when nothing is forwarded', async () => {
    const client = await clientSeenBy('');
    expect(client.ip).toBeTruthy();
  });

  it('logs the chain it reasoned from, so a wrong hop count is visible', async () => {
    const client = await clientSeenBy(`${CALLER}, ${EDGE}`);
    expect(client.ips).toContain(CALLER);
  });
});
