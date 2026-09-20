import { describe, expect, it } from 'vitest';

import { ProblemDetails } from './errors.js';

/** The §1.7 example, parsed as a client would parse it. */
const EXAMPLE = {
  type: 'https://ropa.example/problems/validation',
  title: 'Activity does not satisfy role rules',
  status: 422,
  errors: [
    {
      path: '/purposes',
      code: 'forbidden_for_role',
      message: 'Processor activities cannot have purposes (Art. 30(2))',
    },
    {
      path: '/engagements/1/role',
      code: 'role_not_allowed',
      message: 'Processor activities only allow subprocessor engagements',
    },
  ],
};

describe('ProblemDetails', () => {
  it('parses the example from the API design', () => {
    const parsed = ProblemDetails.parse(EXAMPLE);
    expect(parsed.status).toBe(422);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors?.[0]?.path).toBe('/purposes');
  });

  it('needs a type, title and status', () => {
    expect(ProblemDetails.safeParse({ title: 'x', status: 400 }).success).toBe(false);
    expect(ProblemDetails.safeParse({ type: 'x', status: 400 }).success).toBe(false);
    expect(ProblemDetails.safeParse({ type: 'x', title: 'x' }).success).toBe(false);
  });

  it('keeps extensions, which is how requiredPermission and requestId survive', () => {
    const parsed = ProblemDetails.parse({
      type: 'https://ropa.example/problems/forbidden',
      title: 'Permission denied',
      status: 403,
      requiredPermission: 'activity:approve',
      requestId: 'trace-abc.123',
    });
    expect(parsed['requiredPermission']).toBe('activity:approve');
    expect(parsed['requestId']).toBe('trace-abc.123');
  });

  it('rejects a status that is not a whole number', () => {
    expect(ProblemDetails.safeParse({ ...EXAMPLE, status: 422.5 }).success).toBe(false);
  });
});
