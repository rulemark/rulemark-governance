import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  Problem,
  badRequest,
  conflict,
  fieldErrorsFromZod,
  forbidden,
  notFound,
  preconditionFailed,
  preconditionRequired,
  toProblemDetails,
  unauthorized,
  validationFailed,
} from './problems.js';

describe('Problem', () => {
  it('is an Error, so it can be thrown from a route and caught by Express', () => {
    const problem = notFound('No party with slug "mailcrest"');
    expect(problem).toBeInstanceOf(Error);
    expect(problem).toBeInstanceOf(Problem);
    expect(problem.status).toBe(404);
  });

  it('maps each status in the API design §1.7 table', () => {
    expect(badRequest('bad').status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden('activity:approve').status).toBe(403);
    expect(notFound('gone').status).toBe(404);
    expect(conflict('slug taken').status).toBe(409);
    expect(preconditionFailed('stale').status).toBe(412);
    expect(preconditionRequired('need If-Match').status).toBe(428);
    expect(validationFailed('nope', []).status).toBe(422);
  });

  it('names the required permission on a 403, so the control is visible', () => {
    const details = toProblemDetails(forbidden('activity:approve'));
    expect(details['requiredPermission']).toBe('activity:approve');
  });
});

describe('toProblemDetails', () => {
  it('produces an RFC 9457 document with an absolute type URI', () => {
    const details = toProblemDetails(conflict('Slug "mailcrest" is already taken'));
    expect(details.status).toBe(409);
    expect(details.title).toBe('Conflict');
    expect(details.detail).toBe('Slug "mailcrest" is already taken');
    expect(details.type).toMatch(/^https:\/\/.+\/problems\/conflict$/);
  });

  it('carries the instance and request id when given them', () => {
    const details = toProblemDetails(notFound('gone'), {
      instance: '/v1/parties/nope',
      requestId: 'req-1',
    });
    expect(details.instance).toBe('/v1/parties/nope');
    expect(details['requestId']).toBe('req-1');
  });

  it('turns an unknown error into a 500 that leaks nothing', () => {
    const details = toProblemDetails(new Error('connection string postgres://user:hunter2@host'));
    expect(details.status).toBe(500);
    expect(details.title).toBe('Internal Server Error');
    expect(details.detail).toBeUndefined();
    expect(JSON.stringify(details)).not.toMatch(/hunter2/);
  });

  it('includes the detail of an unknown error when explicitly asked (development)', () => {
    const details = toProblemDetails(new Error('boom'), { includeDetail: true });
    expect(details.status).toBe(500);
    expect(details.detail).toBe('boom');
  });

  it('honours an exposed HTTP error from middleware, such as a malformed JSON body', () => {
    const error = Object.assign(new SyntaxError('Unexpected token } in JSON at position 4'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    const details = toProblemDetails(error);
    expect(details.status).toBe(400);
    expect(details.detail).toMatch(/Unexpected token/);
  });

  it('does not trust an unexposed HTTP error', () => {
    const error = Object.assign(new Error('internal detail'), { status: 400, expose: false });
    expect(toProblemDetails(error).status).toBe(500);
  });

  it('turns a ZodError into a 422 with field errors', () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    const details = toProblemDetails(result.error);
    expect(details.status).toBe(422);
    expect(details.errors?.[0]?.path).toBe('/name');
  });
});

describe('fieldErrorsFromZod', () => {
  const schema = z.object({
    purposes: z.array(z.string()),
    engagements: z.array(z.object({ role: z.string() })),
  });

  it('reports each issue as a JSON Pointer path, like the §1.7 example', () => {
    const result = schema.safeParse({ engagements: [{ role: 1 }] });
    const errors = fieldErrorsFromZod(result.error!);
    const paths = errors.map((error) => error.path);
    expect(paths).toContain('/purposes');
    expect(paths).toContain('/engagements/0/role');
    for (const error of errors) {
      expect(error.code).toBeTruthy();
      expect(error.message).toBeTruthy();
    }
  });

  it('uses the whole-document pointer for a root-level issue', () => {
    const result = z.string().safeParse(42);
    expect(fieldErrorsFromZod(result.error!)[0]?.path).toBe('');
  });

  it('escapes the reserved JSON Pointer characters', () => {
    const result = z
      .object({ 'a/b': z.string(), 'c~d': z.string() })
      .safeParse({ 'a/b': 1, 'c~d': 1 });
    const paths = fieldErrorsFromZod(result.error!).map((error) => error.path);
    expect(paths).toContain('/a~1b');
    expect(paths).toContain('/c~0d');
  });
});
