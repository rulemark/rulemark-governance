import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { createApp } from './app.js';
import { conflict, validationFailed } from './problems.js';

const config = loadConfig({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

function buildApp(router?: Router) {
  return createApp(router ? { config, router } : { config });
}

const PROBLEM_JSON = /^application\/problem\+json/;

/**
 * The real logger, writing parsed JSON lines into an array. Built through
 * `createLogger` on purpose, so its redaction rules are what the tests assert.
 */
function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(loadConfig({ LOG_LEVEL: 'info', NODE_ENV: 'test' }), {
    write(line: string) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines };
}

describe('GET /healthz', () => {
  it('answers 200 for Render’s health check', async () => {
    const response = await request(buildApp()).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.uptime).toBe('number');
  });

  it('needs no token', async () => {
    const response = await request(buildApp()).get('/healthz').set('Authorization', '');
    expect(response.status).toBe(200);
  });
});

describe('request ids', () => {
  it('generates one and returns it', async () => {
    const response = await request(buildApp()).get('/healthz');
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('keeps a sensible one supplied by a caller or proxy', async () => {
    const response = await request(buildApp()).get('/healthz').set('X-Request-Id', 'trace-abc.123');
    expect(response.headers['x-request-id']).toBe('trace-abc.123');
  });

  it('replaces one that is too long to be trustworthy in a log line', async () => {
    const response = await request(buildApp()).get('/healthz').set('X-Request-Id', 'x'.repeat(500));
    expect(response.headers['x-request-id']).not.toBe('x'.repeat(500));
  });
});

describe('errors', () => {
  it('answers an unknown route with 404 problem+json', async () => {
    const response = await request(buildApp()).get('/v1/nothing-here');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(response.body).toMatchObject({ status: 404, title: expect.any(String) });
    expect(response.body.type).toMatch(/problems\/not-found$/);
  });

  it('maps a thrown Problem to its status, keeping the field errors', async () => {
    const router = Router();
    router.get('/boom', () => {
      throw validationFailed('Activity does not satisfy role rules', [
        {
          path: '/purposes',
          code: 'forbidden_for_role',
          message: 'Processor activities cannot have purposes (Art. 30(2))',
        },
      ]);
    });
    const response = await request(buildApp(router)).get('/boom');
    expect(response.status).toBe(422);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(response.body.errors).toHaveLength(1);
    expect(response.body.errors[0].code).toBe('forbidden_for_role');
    expect(response.body.instance).toBe('/boom');
  });

  it('forwards a rejected promise from an async handler (Express 5)', async () => {
    const router = Router();
    router.get('/boom', async () => {
      await Promise.resolve();
      throw conflict('Slug "mailcrest" is already taken');
    });
    const response = await request(buildApp(router)).get('/boom');
    expect(response.status).toBe(409);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
  });

  it('turns an unexpected throw into a 500 that leaks nothing', async () => {
    const router = Router();
    router.get('/boom', () => {
      throw new Error('postgres://user:hunter2@host refused the connection');
    });
    const response = await request(buildApp(router)).get('/boom');
    expect(response.status).toBe(500);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(JSON.stringify(response.body)).not.toMatch(/hunter2/);
    expect(JSON.stringify(response.body)).not.toMatch(/at /);
  });

  it('answers a malformed JSON body with 400 problem+json', async () => {
    const router = Router();
    router.post('/parties', (_req, res) => {
      res.status(201).json({});
    });
    const response = await request(buildApp(router))
      .post('/parties')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(PROBLEM_JSON);
  });

  it('puts the request id in the problem, so a log line can be found from a response', async () => {
    const response = await request(buildApp())
      .get('/v1/nothing-here')
      .set('X-Request-Id', 'trace-abc.123');
    expect(response.body.requestId).toBe('trace-abc.123');
  });
});

describe('JSON bodies', () => {
  it('parses a JSON body for routes that want one', async () => {
    const router = Router();
    router.post('/echo', (req, res) => {
      res.json(req.body);
    });
    const response = await request(buildApp(router)).post('/echo').send({ name: 'Hireloop' });
    expect(response.body).toEqual({ name: 'Hireloop' });
  });
});

describe('logging', () => {
  it('writes exactly one line per request, carrying the problem it ended in', async () => {
    const { logger, lines } = capturingLogger();
    await request(createApp({ config, logger })).get('/v1/nothing-here');

    const requestLines = lines.filter((line) => line['req'] !== undefined);
    expect(requestLines).toHaveLength(1);
    expect(requestLines[0]?.['problem']).toMatchObject({ status: 404 });
  });

  it('says nothing about a passing health check, which Render polls constantly', async () => {
    const { logger, lines } = capturingLogger();
    await request(createApp({ config, logger })).get('/healthz');
    expect(lines).toHaveLength(0);
  });

  it('attaches the error to a 5xx, so the stack is in the log and not the response', async () => {
    const { logger, lines } = capturingLogger();
    const router = Router();
    router.get('/boom', () => {
      throw new Error('postgres://user:hunter2@host refused the connection');
    });
    await request(createApp({ config, logger, router })).get('/boom');

    const line = lines.find((entry) => entry['req'] !== undefined);
    expect(line?.['level']).toBe(50);
    expect(JSON.stringify(line?.['err'])).toMatch(/hunter2/);
  });

  it('keeps a bearer token out of the log', async () => {
    const { logger, lines } = capturingLogger();
    await request(createApp({ config, logger }))
      .get('/v1/nothing-here')
      .set('Authorization', 'Bearer super-secret-token');

    expect(JSON.stringify(lines)).not.toMatch(/super-secret-token/);
    expect(JSON.stringify(lines)).toMatch(/\[redacted\]/);
  });
});
