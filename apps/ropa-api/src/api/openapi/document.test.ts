import SwaggerParser from '@apidevtools/swagger-parser';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from './document.js';
import { RESOURCES } from '../resources/index.js';

const document = buildOpenApiDocument() as {
  openapi: string;
  paths: Record<string, Record<string, { 'x-required-permission'?: string; security?: unknown[] }>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  security: unknown[];
};

describe('the OpenAPI document', () => {
  it('is valid OpenAPI 3.1', async () => {
    // A document Swagger UI happens to render is not the same as a valid one;
    // a generator is exactly the thing that can produce plausible nonsense.
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it('declares bearer auth, which is what gives Swagger UI its Authorize button', () => {
    expect(document.components.securitySchemes['bearerAuth']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.security).toEqual([{ bearerAuth: [] }]);
  });

  it('leaves the routes that need no token unsecured', () => {
    // Documentation you must authenticate for is documentation nobody reads.
    expect(document.paths['/healthz']?.['get']?.security).toEqual([]);
    expect(document.paths['/v1/tokens']?.['post']?.security).toEqual([]);
  });

  it('names the required permission on every guarded operation (§1.9)', () => {
    const guarded = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.entries(operations)
        .filter(([, operation]) => operation.security === undefined)
        .map(([method, operation]) => [`${method} ${path}`, operation] as const),
    );

    expect(guarded.length).toBeGreaterThan(40);
    for (const [route, operation] of guarded) {
      expect(operation['x-required-permission'], route).toBeTruthy();
      // The prose says it too, so a reader of the rendered page sees it.
      expect(JSON.stringify(operation), route).toContain(operation['x-required-permission']);
    }
  });

  it('documents the permission each resource actually declares', () => {
    for (const resource of RESOURCES) {
      const base = `/v1/${resource.path}`;
      expect(document.paths[base]?.['get']?.['x-required-permission'], base).toBe(
        resource.permissions.read,
      );
      expect(document.paths[base]?.['post']?.['x-required-permission'], base).toBe(
        resource.permissions.write,
      );
      expect(document.paths[`${base}/{ref}`]?.['delete']?.['x-required-permission'], base).toBe(
        resource.permissions.delete,
      );
    }
  });

  it('documents every lifecycle action with its own permission and If-Match (§3.4)', () => {
    const actions = RESOURCES.flatMap((resource) =>
      (('actions' in resource ? resource.actions : undefined) ?? []).map(
        (action) => [`/v1/${resource.path}/{ref}/${action.name}`, action.permission] as const,
      ),
    );
    expect(actions.map(([path]) => path)).toEqual([
      '/v1/activities/{ref}/activate',
      '/v1/activities/{ref}/retire',
    ]);
    for (const [path, permission] of actions) {
      const operation = document.paths[path]?.['post'] as
        { 'x-required-permission'?: string; parameters?: { name: string }[] } | undefined;
      expect(operation?.['x-required-permission'], path).toBe(permission);
      expect(
        operation?.parameters?.map((parameter) => parameter.name),
        path,
      ).toContain('If-Match');
    }
    expect(actions.every(([, permission]) => permission === 'activity:approve')).toBe(true);
  });

  it('describes every filter the router applies', () => {
    for (const resource of RESOURCES) {
      const documented = new Set(
        (
          (document.paths[`/v1/${resource.path}`]?.['get'] as { parameters?: { name: string }[] })
            ?.parameters ?? []
        ).map((parameter) => parameter.name),
      );
      for (const filter of resource.filters ?? []) {
        expect(documented, `${resource.path} ?${filter.name}`).toContain(filter.name);
      }
    }
  });

  it('carries the shared schemas, with inputs and outputs kept apart', () => {
    for (const name of ['Party', 'PartyInput', 'Ref', 'ProblemDetails', 'TokenResponse']) {
      expect(document.components.schemas[name], name).toBeDefined();
    }
  });

  it('treats a defaulted field as optional going in and present coming out', () => {
    // This is the whole reason inputs and outputs are converted separately.
    const input = document.components.schemas['AgreementTermsInput'] as { required: string[] };
    const output = document.components.schemas['AgreementTerms'] as { required: string[] };
    expect(input.required).not.toContain('allowedRegions');
    expect(output.required).toContain('allowedRegions');
  });

  it('keeps changeNote out of responses, because it belongs to the change (§1.6)', () => {
    const output = document.components.schemas['Party'] as { properties: Record<string, unknown> };
    expect(output.properties['changeNote']).toBeUndefined();

    const input = document.components.schemas['PartyInput'] as {
      properties: Record<string, unknown>;
    };
    expect(input.properties['changeNote']).toBeDefined();
  });

  it('strips the JSON Schema keywords that mean nothing inside components', () => {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      expect(schema, name).not.toHaveProperty('$schema');
      expect(schema, name).not.toHaveProperty('$id');
    }
  });
});

describe('the committed openapi.json', () => {
  it('matches what the generator produces (the CI drift check)', () => {
    const committed = readFileSync(
      fileURLToPath(new URL('../../../../../packages/ropa-client/openapi.json', import.meta.url)),
      'utf8',
    );
    expect(committed).toBe(`${JSON.stringify(document, null, 2)}\n`);
  });
});
