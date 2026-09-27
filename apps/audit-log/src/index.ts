import { pino } from 'pino';
import { z } from 'zod';

import { createReceiver } from './receiver.js';

/**
 * The receiver's process. It reads its environment once and says which
 * variable is wrong. On Render, a private service is told its port through
 * `PORT`, and `ropa-api` reaches it at the `hostport` the Blueprint wires in.
 */
const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = Env.safeParse(
  Object.fromEntries(Object.entries(process.env).filter(([, value]) => value?.trim())),
);
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  process.stderr.write(`Invalid environment configuration:\n${lines.join('\n')}\n`);
  process.exit(1);
}
const env = parsed.data;

// JSON lines, which Render's log stream parses.
const logger = pino({ level: env.LOG_LEVEL });
const server = createReceiver({ logger });

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'audit-log receiver listening');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');
  // An event cut off here was not answered, so the dispatcher sends it again.
  server.closeIdleConnections();
  server.close(() => {
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
