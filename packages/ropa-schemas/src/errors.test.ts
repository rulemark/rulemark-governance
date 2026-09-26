import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ProblemDetails, fieldErrorsFromZod } from './errors.js';

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

  it('reports a rule’s own code rather than Zod’s generic "custom"', () => {
    const result = z
      .string()
      .refine(() => false, { message: 'No', params: { code: 'forbidden_for_role' } })
      .safeParse('x');
    expect(fieldErrorsFromZod(result.error!)[0]?.code).toBe('forbidden_for_role');
  });

  it('falls back to Zod’s code for a refinement that names none', () => {
    const result = z
      .string()
      .refine(() => false, 'No')
      .safeParse('x');
    expect(fieldErrorsFromZod(result.error!)[0]?.code).toBe('custom');
  });

  it('produces what ProblemDetails accepts', () => {
    const result = schema.safeParse({});
    const problem = {
      type: 'https://ropa.example/problems/validation',
      title: 'Validation failed',
      status: 422,
      errors: fieldErrorsFromZod(result.error!),
    };
    expect(ProblemDetails.safeParse(problem).success).toBe(true);
  });
});
