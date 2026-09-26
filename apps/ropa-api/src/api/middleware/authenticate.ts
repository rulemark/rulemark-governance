import type { Permission, PrincipalRole } from '@rulemark/ropa-schemas';
import type { RequestHandler } from 'express';

import { permissionsFor } from '../../auth/permissions.js';
import { verifyToken } from '../../auth/tokens.js';
import type { Config } from '../../shared/config.js';
import { unauthorized } from '../../shared/problems.js';

/**
 * Works out who is calling (`ropa-api.md` §1.9). It does not refuse anyone:
 * whether a caller may do the thing they asked for is `requires()`'s job. What
 * it does refuse is a token that is present but bad, because silently
 * downgrading such a caller to anonymous would hide an expired session behind
 * a page that merely looks emptier than it should.
 */
export interface Caller {
  readonly authenticated: boolean;
  readonly subject: string | null;
  readonly name: string | null;
  readonly roles: readonly PrincipalRole[];
  readonly permissions: readonly Permission[];
}

declare module 'express-serve-static-core' {
  interface Request {
    caller?: Caller;
  }
}

/**
 * An anonymous caller is treated as a viewer, because the public demo is meant
 * to be readable — unless `REQUIRE_AUTH_FOR_READS` closes that, in which case
 * they hold no permissions at all and every guarded route answers 401. Putting
 * the switch here keeps `requires()` free of configuration.
 */
function anonymous(config: Config): Caller {
  const roles: readonly PrincipalRole[] = config.requireAuthForReads ? [] : ['viewer'];
  return {
    authenticated: false,
    subject: null,
    name: null,
    roles,
    permissions: permissionsFor(roles),
  };
}

function bearerFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') {
    throw unauthorized('Authorization must be a bearer token: Authorization: Bearer <token>');
  }
  const token = rest.join('');
  if (token === '') throw unauthorized('The Authorization header carries no token');
  return token;
}

export function authenticate(config: Config): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        // Development only: trust `X-Actor` so the API can be driven without
        // minting anything. Config refuses this combination in production.
        if (config.authDisabled) {
          const subject = req.get('x-actor') ?? 'anonymous';
          req.caller = {
            authenticated: true,
            subject,
            name: subject,
            roles: ['admin'],
            permissions: permissionsFor(['admin']),
          };
          next();
          return;
        }

        const token = bearerFrom(req.get('authorization'));
        if (token === undefined) {
          req.caller = anonymous(config);
          next();
          return;
        }

        const claims = await verifyToken(token, config.jwtSecret);
        req.caller = {
          authenticated: true,
          subject: claims.sub,
          name: claims.name,
          roles: claims.roles,
          permissions: permissionsFor(claims.roles),
        };
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * Who to record on a revision (§1.6). The actor comes from the token's `sub`,
 * never from a header: an actor callers could choose would undermine the point
 * of the history. `X-Actor` is honoured only when auth is switched off, which
 * configuration forbids in production.
 */
export function actorFor(req: { caller?: Caller }): string {
  const subject = req.caller?.subject;
  if (subject === null || subject === undefined) {
    throw unauthorized('This request needs a token, because the change must record who made it');
  }
  return subject;
}
