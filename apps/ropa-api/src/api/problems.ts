import type { ZodError } from 'zod';

/**
 * RFC 9457 problem details (`application/problem+json`), the single error shape
 * of the API (`ropa-api.md` §1.7).
 *
 * The wire *shape* moves to `@rulemark/ropa-schemas` in Phase 2 so clients can
 * parse it; what lives here is the server-side machinery for building and
 * throwing one, which stays private to the app (`ropa-packages.md` §3).
 */

/** Problem types are URIs. Nothing dereferences them; they identify the kind. */
export const PROBLEM_TYPE_BASE = 'https://ropa.example/problems/';

export interface FieldError {
  /** JSON Pointer (RFC 6901) into the request body: `/engagements/0/role`. */
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
  /** Extensions: `requestId`, `requiredPermission`, … */
  [extension: string]: unknown;
}

interface ProblemInit {
  readonly status: number;
  /** The final segment of the type URI, e.g. `not-found`. */
  readonly type: string;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly errors?: readonly FieldError[] | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
  readonly cause?: unknown;
}

/** An error a route can throw to produce a specific problem response. */
export class Problem extends Error {
  override readonly name = 'Problem';
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[] | undefined;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(init: ProblemInit) {
    super(init.detail ?? init.title, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.type = init.type;
    this.title = init.title;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extensions = init.extensions ?? {};
  }
}

// One constructor per row of the §1.7 status table, so routes never hand-roll a
// status and the vocabulary stays closed.

export function badRequest(detail: string, errors?: readonly FieldError[]): Problem {
  return new Problem({
    status: 400,
    type: 'malformed-request',
    title: 'Malformed request',
    detail,
    errors,
  });
}

export function unauthorized(detail?: string): Problem {
  return new Problem({
    status: 401,
    type: 'unauthorized',
    title: 'Authentication required',
    detail,
  });
}

/** 403 names the permission, so the control is visible rather than mysterious (§1.9). */
export function forbidden(requiredPermission: string, detail?: string): Problem {
  return new Problem({
    status: 403,
    type: 'forbidden',
    title: 'Permission denied',
    detail: detail ?? `This token does not have the ${requiredPermission} permission`,
    extensions: { requiredPermission },
  });
}

export function notFound(detail: string): Problem {
  return new Problem({ status: 404, type: 'not-found', title: 'Resource not found', detail });
}

export function conflict(detail: string, extensions?: Readonly<Record<string, unknown>>): Problem {
  return new Problem({ status: 409, type: 'conflict', title: 'Conflict', detail, extensions });
}

/** 412: the `If-Match` version is out of date (§1.8). */
export function preconditionFailed(
  detail: string,
  extensions?: Readonly<Record<string, unknown>>,
): Problem {
  return new Problem({
    status: 412,
    type: 'version-mismatch',
    title: 'Version mismatch',
    detail,
    extensions,
  });
}

/** 428: a versioned write arrived without `If-Match` (§1.8). */
export function preconditionRequired(detail: string): Problem {
  return new Problem({
    status: 428,
    type: 'if-match-required',
    title: 'If-Match header required',
    detail,
  });
}

/** 422: structural or role-rule validation failed (§1.5). */
export function validationFailed(title: string, errors: readonly FieldError[]): Problem {
  return new Problem({ status: 422, type: 'validation', title, errors });
}

/** 422 `not_yet_supported`, e.g. `joint_controller` (DM §10, Q5). */
export function notYetSupported(detail: string): Problem {
  return new Problem({
    status: 422,
    type: 'not-yet-supported',
    title: 'Not yet supported',
    detail,
  });
}

const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: 'Malformed request',
  401: 'Authentication required',
  403: 'Permission denied',
  404: 'Resource not found',
  405: 'Method not allowed',
  406: 'Not acceptable',
  409: 'Conflict',
  412: 'Version mismatch',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed',
  428: 'If-Match header required',
  429: 'Too many requests',
};

/** RFC 6901: `~` and `/` are the only characters that need escaping. */
function escapePointerSegment(segment: PropertyKey): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function fieldErrorsFromZod(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    // An empty path means the whole document, which RFC 6901 writes as "".
    path: issue.path.map((segment) => `/${escapePointerSegment(segment)}`).join(''),
    code: issue.code,
    message: issue.message,
  }));
}

function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof Error && error.name === 'ZodError' && Array.isArray((error as ZodError).issues)
  );
}

/**
 * Middleware (body parsers, content negotiation) throws `http-errors` objects.
 * `expose: true` is the library's own statement that the message is safe to
 * show a caller, so anything else falls through to a blank 500.
 */
function exposedHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (candidate.expose !== true) return undefined;
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : undefined;
  return status !== undefined && status >= 400 && status < 500 ? status : undefined;
}

export interface ProblemContext {
  /** The request path, reported as `instance`. */
  readonly instance?: string | undefined;
  readonly requestId?: string | undefined;
  /** Development only: put the message of an unexpected error in the response. */
  readonly includeDetail?: boolean | undefined;
}

export function toProblemDetails(error: unknown, context: ProblemContext = {}): ProblemDetails {
  const problem = asProblem(error, context.includeDetail === true);

  const details: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}${problem.type}`,
    title: problem.title,
    status: problem.status,
    ...problem.extensions,
  };
  if (problem.detail !== undefined) details.detail = problem.detail;
  if (context.instance !== undefined) details.instance = context.instance;
  if (problem.errors !== undefined) details.errors = [...problem.errors];
  if (context.requestId !== undefined) details['requestId'] = context.requestId;
  return details;
}

function asProblem(error: unknown, includeDetail: boolean): Problem {
  if (error instanceof Problem) return error;

  if (isZodError(error)) {
    return validationFailed('Request failed validation', fieldErrorsFromZod(error));
  }

  const httpStatus = exposedHttpStatus(error);
  if (httpStatus !== undefined) {
    return new Problem({
      status: httpStatus,
      type: 'malformed-request',
      title: STATUS_TITLES[httpStatus] ?? 'Request failed',
      detail: error instanceof Error ? error.message : undefined,
      cause: error,
    });
  }

  // Anything else is a bug. The caller gets a bare 500; the log gets the error.
  return new Problem({
    status: 500,
    type: 'internal',
    title: 'Internal Server Error',
    detail: includeDetail && error instanceof Error ? error.message : undefined,
    cause: error,
  });
}
