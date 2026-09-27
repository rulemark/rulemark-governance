export const MINUTE = 60_000;

/** DB §7 and API §6: quickly at first, for a consumer that was only restarting. */
const SCHEDULE = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE] as const;
const THEREAFTER = 60 * MINUTE;

/**
 * How long to wait before trying an event again, given how many attempts have
 * been made. Never gives up: a failing event is retried hourly until it is
 * delivered (step 4, Phase 5 question 4).
 */
export function retryDelayMs(attempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(`Not a number of attempts: ${attempts}`);
  }
  return SCHEDULE[attempts - 1] ?? THEREAFTER;
}
