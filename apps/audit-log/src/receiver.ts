import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { EventEnvelope } from '@rulemark/ropa-schemas/events';
import type { Logger } from 'pino';

import { summarize } from './summary.js';

/**
 * A stand-in for the audit log, service #1 (step 4, open question 1): RoPA's
 * dispatcher posts every event here, and it logs each one. Not the audit log
 * itself: it keeps nothing but the log line, and the ids it has seen are held
 * in memory, so a restart forgets them and a resent event is logged again.
 *
 * Delivery is at least once (API §6), so a repeat is answered as delivered
 * and not logged twice. A body that is not an envelope is refused with `400`:
 * a bug in the sender becomes a failure it retries and logs, not a silent
 * loss (Phase 5 questions 3 and 4).
 */

/** Events are a few kilobytes; this is a mistake, not an event. */
export const MAX_BODY_BYTES = 1_000_000;

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new TooLarge());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function answer(res: ServerResponse, status: number, body?: object): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

export function createReceiver(options: { readonly logger: Logger }): Server {
  const { logger } = options;
  const seen = new Set<string>();

  async function receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      if (error instanceof TooLarge) return answer(res, 413, { error: 'too large' });
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      logger.warn({ reason: 'not JSON' }, 'event refused');
      return answer(res, 400, { error: 'not JSON' });
    }

    const parsed = EventEnvelope.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(({ path, message }) => ({ path, message }));
      logger.warn({ reason: 'not an event envelope', issues }, 'event refused');
      return answer(res, 400, { error: 'not an event envelope', issues });
    }

    const event = parsed.data;
    if (seen.has(event.id)) {
      logger.info({ eventId: event.id }, 'duplicate event ignored');
      return answer(res, 204);
    }
    seen.add(event.id);
    logger.info({ event }, summarize(event));
    answer(res, 204);
  }

  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz') return answer(res, 200, { status: 'ok' });
    if (path !== '/events') return answer(res, 404, { error: 'not found' });
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      return answer(res, 405, { error: 'method not allowed' });
    }
    receive(req, res).catch((error: unknown) => {
      logger.error({ err: error }, 'receiving an event failed');
      if (!res.headersSent) answer(res, 500, { error: 'internal error' });
    });
  });
}
