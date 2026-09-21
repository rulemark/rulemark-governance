import { z } from 'zod';

import { RENDER_SYSTEM_KINDS, SYSTEM_KINDS } from '../enums.js';
import { Identifier, MAX_SLUG, Name, Ref, Slug } from '../primitives.js';
import { changeNote, optionalSlug, recordMeta } from './common.js';

/** DM §3.9. Where processing runs. The Architecture Snapshot keeps these in sync. */
const fields = {
  name: Name,
  kind: z.enum(SYSTEM_KINDS),
  renderResourceId: z
    .string()
    .min(1)
    .max(MAX_SLUG)
    .describe('The Render resource id the Architecture Snapshot joins on: "srv-…", "dpg-…".'),
  region: z
    .string()
    .min(1)
    .max(MAX_SLUG)
    .describe('Required for a Render-hosted system: "frankfurt".'),
};

function isRenderHosted(kind: string): boolean {
  return (RENDER_SYSTEM_KINDS as readonly string[]).includes(kind);
}

export const SystemInput = z
  .object({
    slug: optionalSlug,
    name: fields.name,
    kind: fields.kind,
    renderResourceId: fields.renderResourceId.optional(),
    region: fields.region.optional(),
    hostingParty: Identifier,
    changeNote,
  })
  .superRefine((system, ctx) => {
    // system_render_region: anything Render hosts sits in a region, and the
    // region is what makes a transfer question answerable.
    if (isRenderHosted(system.kind) && system.region === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['region'],
        message: 'Required for a Render-hosted system',
      });
    }
  });

export const System = z.object({
  ...recordMeta,
  slug: Slug,
  name: fields.name,
  kind: fields.kind,
  renderResourceId: fields.renderResourceId.nullable(),
  region: fields.region.nullable(),
  hostingParty: Ref,
});

export type SystemInput = z.infer<typeof SystemInput>;
export type System = z.infer<typeof System>;
