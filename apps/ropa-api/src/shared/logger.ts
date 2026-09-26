import { pino, type DestinationStream, type Logger } from 'pino';

import type { Config } from './config.js';

export type { Logger };

/**
 * Structured JSON logs. Render's log stream parses JSON, so on the platform we
 * emit it raw; locally `pino-pretty` makes it readable.
 */
export function createLogger(
  config: Pick<Config, 'logLevel' | 'nodeEnv'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    // A bearer token in a log line is a credential in a log line (§1.9).
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    // A transport and an explicit destination are mutually exclusive, and a
    // test that wants to read the lines needs the destination.
    ...(config.nodeEnv === 'development' && destination === undefined
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}
