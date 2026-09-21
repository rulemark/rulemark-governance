import { z } from 'zod';

import { DATA_CATEGORY_SPECIALS } from '../enums.js';
import { Name, Slug, Text } from '../primitives.js';
import { changeNote, optionalSlug, recordMeta } from './common.js';

/**
 * DM §3.10. The shared vocabularies. The DSAR tracker and the Subprocessor
 * Monitor reference these by slug, which is why the slug matters more here than
 * anywhere else.
 */
const inputFields = {
  slug: optionalSlug,
  name: Name,
  description: Text.optional(),
  changeNote,
};

const outputFields = {
  ...recordMeta,
  slug: Slug,
  name: Name,
  description: Text.nullable(),
};

const special = z
  .enum(DATA_CATEGORY_SPECIALS)
  .describe('art9: a special category. art10: criminal convictions.');

export const SubjectCategoryInput = z.object(inputFields);
export const SubjectCategory = z.object(outputFields);

export const DataCategoryInput = z.object({ ...inputFields, special: special.default('none') });
export const DataCategory = z.object({ ...outputFields, special });

export const SecurityMeasureInput = z.object(inputFields);
export const SecurityMeasure = z.object(outputFields);

export type SubjectCategoryInput = z.infer<typeof SubjectCategoryInput>;
export type SubjectCategory = z.infer<typeof SubjectCategory>;
export type DataCategoryInput = z.infer<typeof DataCategoryInput>;
export type DataCategory = z.infer<typeof DataCategory>;
export type SecurityMeasureInput = z.infer<typeof SecurityMeasureInput>;
export type SecurityMeasure = z.infer<typeof SecurityMeasure>;
