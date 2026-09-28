import { ProblemDetails, type FieldError } from '@rulemark/ropa-schemas';
import type { z } from 'zod';

/**
 * Every failed call (ropa-packages.md §5.3): the status, the problem the API
 * answered with (RFC 9457, extension members included), and the response.
 */
export class RopaError extends Error {
  override name = 'RopaError';

  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
    readonly response: Response,
  ) {
    super(problem.detail ?? problem.title);
  }
}

/** 422: the request didn't validate; `errors` are field-level, JSON Pointer paths. */
export class RopaValidationError extends RopaError {
  override name = 'RopaValidationError';

  get errors(): FieldError[] {
    return this.problem.errors ?? [];
  }
}

/** 409: a slug taken, a record still referenced, a transition not allowed. */
export class RopaConflictError extends RopaError {
  override name = 'RopaConflictError';
}

/** 412 or 428: a stale version, or none sent (API §1.8). */
export class RopaPreconditionError extends RopaError {
  override name = 'RopaPreconditionError';
}

/** 404. */
export class RopaNotFoundError extends RopaError {
  override name = 'RopaNotFoundError';
}

/**
 * The API answered, but not in the shape this package knows: the deployed
 * service and the package have drifted apart. `issues` says where.
 */
export class RopaResponseError extends Error {
  override name = 'RopaResponseError';

  constructor(
    readonly issues: z.core.$ZodIssue[],
    readonly response: Response,
  ) {
    const where = issues[0]?.path.join('.') || 'the body';
    super(`The API's response doesn't match @rulemark/ropa-client (at ${where})`);
  }
}

const KINDS: Partial<Record<number, typeof RopaError>> = {
  404: RopaNotFoundError,
  409: RopaConflictError,
  412: RopaPreconditionError,
  422: RopaValidationError,
  428: RopaPreconditionError,
};

const TITLES: Partial<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * The error for a failed response. A body that isn't a problem, from a proxy
 * or a load balancer in between, still becomes a RopaError, with a problem
 * made from the status.
 */
export async function errorFrom(response: Response): Promise<RopaError> {
  const text = await response.text();
  let problem: ProblemDetails | undefined;
  try {
    const parsed = ProblemDetails.safeParse(JSON.parse(text));
    if (parsed.success) problem = parsed.data;
  } catch {
    // Not JSON.
  }
  problem ??= {
    type: 'about:blank',
    title: response.statusText || TITLES[response.status] || `HTTP ${response.status}`,
    status: response.status,
  };
  const Kind = KINDS[response.status] ?? RopaError;
  return new Kind(response.status, problem, response);
}
