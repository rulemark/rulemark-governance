import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from './document.js';

/**
 * Writes the document into the client package (`ropa-packages.md` §5.4, §7).
 * It ships inside `@rulemark/ropa-client` rather than as a package of its own,
 * and CI fails if this leaves the file changed — the same trick as the Drizzle
 * migration check.
 */
const TARGET = fileURLToPath(
  new URL('../../../../../packages/ropa-client/openapi.json', import.meta.url),
);

const document = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, document, 'utf8');

process.stdout.write(`openapi.json written to ${TARGET}\n`);
