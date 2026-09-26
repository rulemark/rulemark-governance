import { z } from 'zod';

import { AUTHORIZATION_TYPES, TRANSFER_MECHANISMS } from '../enums.js';
import {
  AsOf,
  Code,
  CountryCode,
  Identifier,
  IsoDate,
  IsoDateTime,
  Name,
  Ref,
  Uuid,
} from '../primitives.js';

/**
 * `GET /subprocessors` (`ropa-api.md` §5.2): the list a client is owed under
 * Art. 28(2), derived from the record rather than kept as a page. By offering
 * it is the standard terms, which is also the public subprocessor page; by
 * client it is that client's actual terms (DM §3.8, §7).
 */

export const SubprocessorsQuery = z
  .object({
    offering: Identifier.optional().describe('The standard terms of this offering.'),
    client: Identifier.optional().describe('What this client actually gets.'),
    asOf: AsOf.optional().describe('The list as it stood then.'),
  })
  .superRefine((query, ctx) => {
    if ((query.offering === undefined) === (query.client === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Ask by exactly one of offering or client',
        params: { code: 'exactly_one_scope' },
      });
    }
  });

/** Terms, with the two properties a subprocessor change depends on (Art. 28(2)). */
export const TermsRef = Ref.extend({
  authorizationType: z.enum(AUTHORIZATION_TYPES),
  noticeDays: z.number().int().min(0),
});

/** An activity named in a view: always with its code, which never changes. */
export const ActivityRef = z.object({ id: Uuid, code: Code, name: Name });

export const Subprocessor = z.object({
  party: Ref,
  /** What the party does, one entry per distinct service description. */
  services: z.array(Name),
  /** Where it processes or accesses the data, which is not its HQ. */
  processingCountries: z.array(CountryCode),
  transfers: z.array(
    z.object({
      destinationCountry: CountryCode,
      mechanism: z.enum(TRANSFER_MECHANISMS),
      onwardVia: Name.nullable(),
    }),
  ),
  /** The processing it takes part in. */
  activities: z.array(ActivityRef),
});

export const SubprocessorsResponse = z.object({
  generatedAt: IsoDateTime,
  asOf: IsoDate.nullable(),
  scope: z.object({
    offering: Ref,
    /** Null for the offering's standard terms. */
    client: Ref.nullable(),
    /** The offering's default terms, or the terms the client signed. */
    terms: TermsRef,
  }),
  subprocessors: z.array(Subprocessor),
  /**
   * Opt-in modules of the offering and what each adds (offering view only). In
   * a client's view the modules it enabled are part of its list.
   */
  optionalModules: z.array(
    z.object({ activity: ActivityRef, subprocessors: z.array(Subprocessor) }),
  ),
});

export type SubprocessorsQuery = z.infer<typeof SubprocessorsQuery>;
export type TermsRef = z.infer<typeof TermsRef>;
export type ActivityRef = z.infer<typeof ActivityRef>;
export type Subprocessor = z.infer<typeof Subprocessor>;
export type SubprocessorsResponse = z.infer<typeof SubprocessorsResponse>;
