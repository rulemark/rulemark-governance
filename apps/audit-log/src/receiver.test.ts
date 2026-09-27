import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReceiver, MAX_BODY_BYTES } from './receiver.js';

/**
 * The audit log's stand-in (step 4, Phase 5): `POST /events` answers `2xx`,
 * ignores an id it has already seen, and logs each event. Tested over real
 * HTTP, as the dispatcher will call it.
 */

let server: Server;
let base: string;
let lines: { level: number; msg: string; [key: string]: unknown }[];

beforeEach(async () => {
  lines = [];
  const logger = pino(
    { level: 'debug' },
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as (typeof lines)[number]);
        done();
      },
    }),
  );
  server = createReceiver({ logger });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const p3Created = {
  id: '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e',
  type: 'record.changed',
  source: 'ropa',
  occurredAt: '2026-04-14T10:02:11.000Z',
  data: {
    entityType: 'activity',
    entity: { id: '0199c3a1-8f2e-7c4d-b8e1-000000000001', code: 'P3', name: 'CV parsing' },
    version: 1,
    changeType: 'created',
    actor: 'priya.raman',
    changeNote: 'Added Scribe AI for CV parsing',
    validFrom: '2026-04-14T10:02:11.000Z',
  },
};

const post = (body: string, path = '/events') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

const received = () => lines.filter((line) => line.msg.startsWith('record.changed'));

describe('POST /events', () => {
  it('accepts an event and logs it: a summary, and the whole event', async () => {
    const response = await post(JSON.stringify(p3Created));

    expect(response.status).toBe(204);
    expect(received()).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'record.changed activity P3 v1 created by priya.raman',
        event: p3Created,
      }),
    ]);
  });

  it('answers a repeat as delivered, and logs it once', async () => {
    await post(JSON.stringify(p3Created));
    const again = await post(JSON.stringify(p3Created));

    expect(again.status).toBe(204);
    expect(received()).toHaveLength(1);
    expect(lines.find((line) => line.msg === 'duplicate event ignored')).toMatchObject({
      eventId: p3Created.id,
    });
  });

  it('refuses a body that is not JSON', async () => {
    const response = await post('{"id":');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'not JSON' });
  });

  it('refuses an envelope that is not one, saying what is wrong, and does not remember it', async () => {
    const response = await post(JSON.stringify({ ...p3Created, source: 'monitor' }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; issues: { path: string[] }[] };
    expect(body.error).toBe('not an event envelope');
    expect(body.issues.map((issue) => issue.path)).toEqual([['source']]);
    expect(lines.find((line) => line.msg === 'event refused')).toMatchObject({ level: 40 });

    // Fixed and sent again, the event is new.
    expect((await post(JSON.stringify(p3Created))).status).toBe(204);
    expect(received()).toHaveLength(1);
  });

  it('refuses a body too large to be an event', async () => {
    const response = await post(JSON.stringify({ ...p3Created, pad: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(response.status).toBe(413);
  });
});

describe('everything else', () => {
  it('answers the health check', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('answers only POST on /events', async () => {
    const response = await fetch(`${base}/events`);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('knows no other path', async () => {
    expect((await post(JSON.stringify(p3Created), '/event')).status).toBe(404);
  });
});
