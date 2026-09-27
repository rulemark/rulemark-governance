import type { Logger } from '../shared/logger.js';
import { MINUTE } from './backoff.js';
import type { DispatchResult } from './dispatcher.js';

/**
 * The loop around `dispatchOnce()` (step 4, open question 2). It runs inside
 * `ropa-api` for the demo; a Render background worker later would start the
 * same runner from its own entry point.
 *
 * On `SIGTERM` (every deploy) it stops claiming and lets the batch in flight
 * finish, so the process exits with nothing claimed and unsent; anything that
 * does go astray is resent once its lease runs out.
 */

export interface RunnerOptions {
  /** One pass: `dispatchOnce` bound to its database and destinations. */
  readonly dispatch: () => Promise<DispatchResult>;
  /** Deletes delivered rows past retention: `cleanupDelivered`, bound. */
  readonly cleanup: () => Promise<number>;
  readonly logger: Logger;
  /** How long to wait after a pass that found nothing due. */
  readonly idleMs?: number;
  readonly cleanupEveryMs?: number;
}

export interface Runner {
  /** Resolves once the pass in flight, if any, has finished. */
  stop(): Promise<void>;
}

const DEFAULTS = { idleMs: 5_000, cleanupEveryMs: 60 * MINUTE } as const;

export function startRunner(options: RunnerOptions): Runner {
  const idleMs = options.idleMs ?? DEFAULTS.idleMs;
  const cleanupEveryMs = options.cleanupEveryMs ?? DEFAULTS.cleanupEveryMs;

  let stopping = false;
  let wake: (() => void) | undefined;
  let lastCleanup = Number.NEGATIVE_INFINITY;

  /** Waits `ms`, or until `stop()` is called. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function cleanUpIfDue(): Promise<void> {
    if (Date.now() - lastCleanup < cleanupEveryMs) return;
    lastCleanup = Date.now();
    try {
      const deleted = await options.cleanup();
      if (deleted > 0) options.logger.info({ deleted }, 'delivered events cleaned up');
    } catch (error) {
      options.logger.error({ err: error }, 'outbox cleanup failed');
    }
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      await cleanUpIfDue();
      if (stopping) break;

      let busy = false;
      try {
        // Work found means there may be more: a record's next version only
        // becomes due once this pass has delivered the one before it.
        busy = (await options.dispatch()).claimed > 0;
      } catch (error) {
        // The database restarting, most likely. The rows are untouched or
        // leased; either way they are safe to try again after a pause.
        options.logger.error({ err: error }, 'outbox dispatch failed');
      }
      if (!busy && !stopping) await sleep(idleMs);
    }
  }

  const running = loop();

  return {
    stop() {
      stopping = true;
      wake?.();
      return running;
    },
  };
}
