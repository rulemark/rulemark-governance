import { Router } from 'express';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../shared/config.js';
import { createApp } from './app.js';
import { requires } from './middleware/authorize.js';

const BASE_ENV = {
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://ropa:ropa@localhost:5432/ropa',
  JWT_SECRET: 'a-secret-long-enough-for-hs256-signing',
  TOKEN_MINT_SECRET: 'the-mint-secret-nobody-should-guess',
  PRINCIPALS: JSON.stringify([
    { sub: 'priya.raman', name: 'Priya Raman', roles: ['editor', 'approver'] },
    { sub: 'tomas.herrera', name: 'Tomás Herrera', roles: ['editor'] },
    { sub: 'reader', name: 'A Reader', roles: ['viewer'] },
    { sub: 'svc:monitor', name: 'Subprocessor Monitor', roles: ['service:monitor'] },
  ]),
};

/**
 * Apps are built once per configuration rather than once per assertion.
 * Building one is not free — it constructs the routers and the OpenAPI
 * document — and each `request(app)` binds an ephemeral port, so churning
 * dozens of them makes the suite slower and noisier than it needs to be.
 */
const servers = new Map<string, Server>();

/**
 * One listening server per configuration, reused across the file. `request(app)`
 * starts and stops an ephemeral server per call; hundreds of those in quick
 * succession is slow and a source of confusing failures.
 */
function appWith(overrides: Record<string, string> = {}): Server {
  const key = JSON.stringify(overrides);
  const existing = servers.get(key);
  if (existing !== undefined) return existing;

  const server = buildAppWith(overrides).listen(0);
  servers.set(key, server);
  return server;
}

afterAll(async () => {
  await Promise.all(
    [...servers.values()].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

function buildAppWith(overrides: Record<string, string>) {
  const config = loadConfig({ ...BASE_ENV, ...overrides });

  // A stand-in for the record routes Phase 6 adds, declaring the same
  // permissions they will.
  const router = Router();
  router.get('/v1/parties', requires('record:read'), (_req, res) => {
    res.json({ data: [], nextCursor: null });
  });
  router.post('/v1/parties', requires('record:write'), (_req, res) => {
    res.status(201).json({ ok: true });
  });
  router.post('/v1/activities/:ref/activate', requires('activity:approve'), (_req, res) => {
    res.json({ ok: true });
  });
  router.delete('/v1/parties/:ref', requires('record:delete'), (_req, res) => {
    res.status(204).end();
  });

  return createApp({ config, router });
}

async function mint(app: Server, subject: string): Promise<string> {
  const response = await request(app)
    .post('/v1/tokens')
    .send({ subject, secret: BASE_ENV.TOKEN_MINT_SECRET });
  expect(response.status).toBe(200);
  return response.body.token as string;
}

const PROBLEM_JSON = /^application\/problem\+json/;

describe('POST /v1/tokens', () => {
  it('mints a token for a known subject, with its roles and permissions', async () => {
    const response = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'priya.raman', secret: BASE_ENV.TOKEN_MINT_SECRET });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      subject: 'priya.raman',
      name: 'Priya Raman',
      roles: ['editor', 'approver'],
    });
    expect(response.body.expiresIn).toBe(8 * 60 * 60);
    expect(response.body.permissions).toContain('record:write');
    expect(response.body.permissions).toContain('activity:approve');
  });

  it('needs no token of its own, or nobody could ever start', async () => {
    const response = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'reader', secret: BASE_ENV.TOKEN_MINT_SECRET });
    expect(response.status).toBe(200);
  });

  it('refuses the wrong secret with 401', async () => {
    const response = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'priya.raman', secret: 'wrong' });
    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
  });

  it('refuses an unknown subject with 401', async () => {
    const response = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'mallory', secret: BASE_ENV.TOKEN_MINT_SECRET });
    expect(response.status).toBe(401);
  });

  it('does not say which of the two was wrong', async () => {
    const unknownSubject = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'mallory', secret: BASE_ENV.TOKEN_MINT_SECRET });
    const wrongSecret = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'priya.raman', secret: 'wrong' });

    // Telling them apart turns the endpoint into a list of valid subjects.
    expect(unknownSubject.body.detail).toBe(wrongSecret.body.detail);
  });

  it('never echoes back the secret it was given, or the real one', async () => {
    const attempted = 'hunter2-guessed-secret';
    const response = await request(appWith())
      .post('/v1/tokens')
      .send({ subject: 'priya.raman', secret: attempted });

    expect(JSON.stringify(response.body)).not.toContain(attempted);
    expect(JSON.stringify(response.body)).not.toContain(BASE_ENV.TOKEN_MINT_SECRET);
  });

  it('rejects a malformed body with 422 and field errors', async () => {
    const response = await request(appWith()).post('/v1/tokens').send({ subject: 'priya.raman' });
    expect(response.status).toBe(422);
    expect(response.body.errors?.[0]?.path).toBe('/secret');
  });

  it('is rate limited, so the secret cannot be guessed at speed', async () => {
    // Its own app: this deliberately exhausts the limiter, which would then
    // refuse the other tests sharing a configuration.
    const app = buildAppWith({}).listen(0);
    servers.set(`rate-limit-${Date.now()}`, app);
    const attempts = [];
    for (let i = 0; i < 25; i += 1) {
      attempts.push(
        await request(app).post('/v1/tokens').send({ subject: 'priya.raman', secret: 'wrong' }),
      );
    }
    expect(attempts.some((response) => response.status === 429)).toBe(true);
    const limited = attempts.find((response) => response.status === 429);
    expect(limited?.headers['content-type']).toMatch(PROBLEM_JSON);
  });
});

describe('GET /v1/me', () => {
  it('describes an authenticated caller', async () => {
    const app = appWith();
    const token = await mint(app, 'priya.raman');

    const response = await request(app).get('/v1/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      authenticated: true,
      subject: 'priya.raman',
      name: 'Priya Raman',
      roles: ['editor', 'approver'],
    });
  });

  it('describes an anonymous caller as a viewer (§1.9)', async () => {
    const response = await request(appWith()).get('/v1/me');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ authenticated: false, subject: null, roles: ['viewer'] });
    expect(response.body.permissions).toContain('record:read');
    expect(response.body.permissions).not.toContain('record:write');
  });
});

describe('reading', () => {
  it('is public by default, and the caller is a viewer', async () => {
    const response = await request(appWith()).get('/v1/parties');
    expect(response.status).toBe(200);
  });

  it('needs a token when REQUIRE_AUTH_FOR_READS is set', async () => {
    const app = appWith({ REQUIRE_AUTH_FOR_READS: 'true' });

    expect((await request(app).get('/v1/parties')).status).toBe(401);

    const token = await mint(app, 'reader');
    expect(
      (await request(app).get('/v1/parties').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(200);
  });

  it('leaves the health check and token minting open even then', async () => {
    const app = appWith({ REQUIRE_AUTH_FOR_READS: 'true' });
    expect((await request(app).get('/healthz')).status).toBe(200);
    expect(
      (
        await request(app)
          .post('/v1/tokens')
          .send({ subject: 'reader', secret: BASE_ENV.TOKEN_MINT_SECRET })
      ).status,
    ).toBe(200);
  });
});

describe('writing', () => {
  it('refuses an anonymous write with 401, not 403', async () => {
    // 403 would imply we know who is asking.
    const response = await request(appWith()).post('/v1/parties').send({});
    expect(response.status).toBe(401);
  });

  it('accepts a write from an editor', async () => {
    const app = appWith();
    const token = await mint(app, 'tomas.herrera');
    const response = await request(app)
      .post('/v1/parties')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(201);
  });

  it('refuses a viewer with 403 naming the permission (§1.9)', async () => {
    const app = appWith();
    const token = await mint(app, 'reader');

    const response = await request(app)
      .post('/v1/parties')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(response.body.requiredPermission).toBe('record:write');
  });

  it('refuses an editor the approval they did not earn', async () => {
    const app = appWith();
    const token = await mint(app, 'tomas.herrera');

    const response = await request(app)
      .post('/v1/activities/P3/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('activity:approve');
  });

  it('lets the approver approve', async () => {
    const app = appWith();
    const token = await mint(app, 'priya.raman');
    const response = await request(app)
      .post('/v1/activities/P3/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(200);
  });

  it('refuses everyone but an admin the delete', async () => {
    const app = appWith();
    for (const subject of ['priya.raman', 'tomas.herrera', 'reader']) {
      const token = await mint(app, subject);
      const response = await request(app)
        .delete('/v1/parties/mailcrest')
        .set('Authorization', `Bearer ${token}`);
      expect(response.status, subject).toBe(403);
      expect(response.body.requiredPermission).toBe('record:delete');
    }
  });

  it('holds a service token to its own narrow role', async () => {
    const app = appWith();
    const token = await mint(app, 'svc:monitor');

    // The Monitor may open review items, and nothing else.
    const response = await request(app)
      .post('/v1/parties')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(403);
  });
});

describe('bad tokens', () => {
  it('refuses a token signed with another secret', async () => {
    const other = appWith({ JWT_SECRET: 'a-different-secret-entirely-here' });
    const token = await mint(other, 'priya.raman');

    const response = await request(appWith())
      .post('/v1/parties')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(response.status).toBe(401);
  });

  it('refuses a malformed Authorization header', async () => {
    for (const header of ['Bearer', 'Bearer   ', 'Basic abc', 'abc']) {
      const response = await request(appWith()).get('/v1/me').set('Authorization', header);
      expect(response.status, `${header} -> ${JSON.stringify(response.body)}`).toBe(401);
    }
  });

  it('refuses a bad token even on a public read, rather than falling back to viewer', async () => {
    // A caller who sent a token meant to be authenticated; silently
    // downgrading them would hide an expired session.
    const response = await request(appWith())
      .get('/v1/parties')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });
});
