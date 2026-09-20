import { z } from 'zod';

import { PARTY_KINDS } from '../enums.js';
import { CountryCode, Slug } from '../primitives.js';
import { changeNote, optionalSlug, recordMeta } from './common.js';

/** DM §3.5. One `party` table covers us, our clients, our vendors and everyone else. */
const fields = {
  kind: z.enum(PARTY_KINDS),
  legalName: z.string().min(1).describe('The registered name. Doubles as the party’s name.'),
  country: CountryCode.describe('Where the legal entity is established.'),
  contactName: z.string().min(1),
  contactEmail: z.email(),
  dpoName: z.string().min(1).describe('Required on the self party (Art. 30(1)(a)).'),
  dpoEmail: z.email().describe('Required on the self party (Art. 30(1)(a)).'),
  trustUrl: z.url().describe('A vendor’s trust or security page.'),
  dpaUrl: z.url().describe('A vendor’s published DPA.'),
  subprocessorListUrl: z.url().describe('What the Subprocessor Monitor watches.'),
};

export const PartyInputBase = z.object({
  slug: optionalSlug,
  kind: fields.kind,
  legalName: fields.legalName,
  country: fields.country,
  contactName: fields.contactName.optional(),
  contactEmail: fields.contactEmail.optional(),
  dpoName: fields.dpoName.optional(),
  dpoEmail: fields.dpoEmail.optional(),
  trustUrl: fields.trustUrl.optional(),
  dpaUrl: fields.dpaUrl.optional(),
  subprocessorListUrl: fields.subprocessorListUrl.optional(),
  changeNote,
});

/**
 * The self party must name a DPO: Art. 30(1)(a) requires the controller's and
 * the DPO's contact details in the record itself. This is a rule about one
 * record and nothing else, so it lives in the schema and a form can run it
 * (`ropa-packages.md` §4.3).
 */
export const PartyInput = PartyInputBase.superRefine((party, ctx) => {
  if (party.kind !== 'self') return;

  for (const field of ['dpoName', 'dpoEmail'] as const) {
    if (party[field] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Required on the self party (Art. 30(1)(a))',
      });
    }
  }
});

export const Party = z.object({
  ...recordMeta,
  slug: Slug,
  kind: fields.kind,
  /** Mirrors `legalName`, so every record answers to `name` (§4). */
  name: z.string().min(1),
  legalName: fields.legalName,
  country: fields.country,
  contactName: fields.contactName.nullable(),
  contactEmail: fields.contactEmail.nullable(),
  dpoName: fields.dpoName.nullable(),
  dpoEmail: fields.dpoEmail.nullable(),
  trustUrl: fields.trustUrl.nullable(),
  dpaUrl: fields.dpaUrl.nullable(),
  subprocessorListUrl: fields.subprocessorListUrl.nullable(),
});

export type PartyInput = z.infer<typeof PartyInput>;
export type Party = z.infer<typeof Party>;
