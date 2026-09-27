import { z } from 'zod';

import { EVENT_TYPES } from './enums.js';
import { IsoDateTime, Uuid } from './primitives.js';

/**
 * The envelope every consumer of RoPA's events receives (`ropa-api.md` §6),
 * delivered by `POST` to each consumer's address. A contract like the OpenAPI
 * document, for the other direction: the API writes events that satisfy it,
 * and its consumers (the audit log, the Monitor) read them with it.
 *
 * Only the frame, for now: each event's `data` is described in §6 and checked
 * by the consumer that needs it (step 4, Phase 5 question 3).
 */
export const EventEnvelope = z
  .object({
    id: Uuid.describe(
      'The event’s id. Delivery is at least once, so a consumer ignores an id it has already seen.',
    ),
    type: z.enum(EVENT_TYPES),
    source: z.literal('ropa'),
    occurredAt: IsoDateTime.describe('When the change the event describes took effect.'),
    data: z.record(z.string(), z.unknown()).describe('What happened; its shape depends on `type`.'),
  })
  .describe('An event RoPA pushes to its consumers (§6).');

export type EventEnvelope = z.infer<typeof EventEnvelope>;
