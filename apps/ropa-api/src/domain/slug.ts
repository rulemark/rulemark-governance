/**
 * A slug is derived from the name when the caller does not supply one
 * (`ropa-api.md` §1.2). It cannot be changed through the API in v1, because
 * changing one after it has been shared breaks URLs and seed files.
 */

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns undefined when nothing usable is left. The caller then asks for an
 * explicit slug, which is better than silently storing something like `-` that
 * nobody could guess or type.
 */
export function slugify(name: string): string | undefined {
  const slug = name
    .normalize('NFKD')
    // Strip the accents NFKD just separated, so "Tomás" folds to "tomas"
    // rather than losing the letter altogether.
    .replaceAll(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  if (slug === '') return undefined;

  // A slug may never be UUID-shaped, or a path segment stops being
  // distinguishable from an id (DM §3.0). Only a name that is itself a UUID
  // can get here.
  return UUID_SHAPED.test(slug) ? `${slug}-record` : slug;
}
