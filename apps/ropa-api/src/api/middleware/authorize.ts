import type { Permission } from '@rulemark/ropa-schemas';
import type { RequestHandler } from 'express';

import { forbidden, unauthorized } from '../../shared/problems.js';

/**
 * Each route declares the one permission it needs (`ropa-api.md` §1.9).
 *
 * The 401/403 split says something specific. 403 means "we know who you are and
 * you may not", and names the permission, so the control is visible rather than
 * mysterious. 401 means "we do not know who you are" — which is what an
 * anonymous write is, since an anonymous caller is only ever a viewer.
 *
 * This reads nothing but the request: `authenticate` has already turned the
 * configuration into the caller's roles, so `REQUIRE_AUTH_FOR_READS` needs no
 * second opinion here.
 */
export function requires(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    const caller = req.caller;
    if (caller === undefined) {
      next(unauthorized('This request was not authenticated'));
      return;
    }

    if (caller.permissions.includes(permission)) {
      next();
      return;
    }

    next(
      caller.authenticated
        ? forbidden(permission)
        : unauthorized(`This request needs a token with the ${permission} permission`),
    );
  };
}
