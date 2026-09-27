import type { AddressInfo } from 'node:net';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { listenOnLoopback } from './listen.js';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('listenOnLoopback', () => {
  it('binds 127.0.0.1 alone, on a random port', async () => {
    const server = await listenOnLoopback(http.createServer());
    servers.push(server);

    const address = server.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);
  });

  it('resolves only once the server is listening', async () => {
    const server = await listenOnLoopback(http.createServer());
    servers.push(server);

    expect(server.listening).toBe(true);
    expect(server.address()).not.toBeNull();
  });

  // What `listen(0)` risked: a port another process holds on 127.0.0.1 alone.
  // Loopback can't be given it, so the tests' requests always reach the app.
  it('is never given a port another process holds on 127.0.0.1', async () => {
    const other = await listenOnLoopback(http.createServer());
    servers.push(other);
    const taken = (other.address() as AddressInfo).port;

    const attempt = http.createServer();
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      attempt.once('error', resolve);
      attempt.listen(taken, '127.0.0.1');
    });

    expect(error.code).toBe('EADDRINUSE');
  });
});
