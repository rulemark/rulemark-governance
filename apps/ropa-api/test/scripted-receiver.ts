import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A real HTTP consumer for the dispatcher's tests (step 4, open question 7):
 * no mocked fetch, so timeouts, refused connections and status codes are the
 * real thing. Each request is answered by the next scripted behaviour, or by
 * the default once the script runs out.
 */
export type Behaviour =
  | { readonly kind: 'answer'; readonly status: number }
  /** Never answers: the dispatcher's timeout has to end it. */
  | { readonly kind: 'hang' }
  /** Answers once `release()` is called: a send still in flight. */
  | { readonly kind: 'hold' };

export const ok: Behaviour = { kind: 'answer', status: 204 };
export const fail = (status = 500): Behaviour => ({ kind: 'answer', status });
export const hang: Behaviour = { kind: 'hang' };
export const hold: Behaviour = { kind: 'hold' };

export interface Received {
  readonly path: string;
  readonly contentType: string | undefined;
  readonly body: { readonly id: string; readonly [key: string]: unknown };
}

export interface ScriptedReceiver {
  readonly url: string;
  /** Every request, in the order it arrived, whatever it was answered. */
  readonly received: Received[];
  /** Queues behaviours for the next requests. */
  script(...behaviours: Behaviour[]): void;
  /** Resolves when `count` requests in all have arrived. */
  waitFor(count: number): Promise<void>;
  /** Answers every held request, 204 unless told otherwise. */
  release(status?: number): void;
  close(): Promise<void>;
}

export async function startReceiver(
  defaultBehaviour: Behaviour = ok,
  path = '/events',
): Promise<ScriptedReceiver> {
  const queue: Behaviour[] = [];
  const received: Received[] = [];
  const held: ServerResponse[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        contentType: req.headers['content-type'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Received['body'],
      });
      for (const waiter of waiters.filter((w) => received.length >= w.count)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }

      const behaviour = queue.shift() ?? defaultBehaviour;
      if (behaviour.kind === 'answer') res.writeHead(behaviour.status).end();
      if (behaviour.kind === 'hold') held.push(res);
      // 'hang': leave it; close() ends it.
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${path}`,
    received,
    script: (...behaviours) => queue.push(...behaviours),
    waitFor: (count) =>
      received.length >= count
        ? Promise.resolve()
        : new Promise((resolve) => waiters.push({ count, resolve })),
    release: (status = 204) => {
      for (const res of held.splice(0)) res.writeHead(status).end();
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
