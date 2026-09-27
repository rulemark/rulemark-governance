import { once } from 'node:events';
import type { Server } from 'node:http';

/**
 * Starts an app on a random free port on 127.0.0.1, and resolves once it's
 * listening.
 *
 * Loopback, because that's where the tests' requests go (supertest calls
 * `127.0.0.1:<port>`). `listen(0)` binds every interface instead, and on
 * macOS the port handed out can be one another process holds on 127.0.0.1
 * alone: the requests then reach that process, and fail with its answers.
 *
 * Awaited, because with a host Node binds asynchronously: until `listening`,
 * `address()` is null, and supertest, finding no address, would call
 * `listen(0)` itself.
 */
export async function listenOnLoopback(app: {
  listen(port: number, host: string): Server;
}): Promise<Server> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
