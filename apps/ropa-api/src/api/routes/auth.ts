import { timingSafeEqual } from 'node:crypto';
import { MeResponse, TokenRequest, TokenResponse } from '@rulemark/ropa-schemas';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { permissionsFor } from '../../auth/permissions.js';
import { signToken } from '../../auth/tokens.js';
import type { Config } from '../../shared/config.js';
import { fieldErrorsFromZod, unauthorized, validationFailed } from '../../shared/problems.js';

/**
 * Minting and introspection (`ropa-api.md` §1.9). Neither route needs a token:
 * `POST /v1/tokens` is where a token comes from, and `GET /v1/me` is how a UI
 * finds out it has none.
 */

/** Constant-time, so the comparison itself does not leak the secret. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would leak the length.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function authRouter(config: Config): Router {
  const router = Router();

  const mintLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Rate limiting answers in the API's own error shape, not plain text.
    handler: (_req, res) => {
      res.status(429).type('application/problem+json').json({
        type: 'https://ropa.example/problems/too-many-requests',
        title: 'Too many requests',
        status: 429,
        detail: 'Too many token requests. Try again in a few minutes.',
      });
    },
  });

  router.post('/tokens', mintLimiter, (req, res, next) => {
    void (async () => {
      try {
        const body = TokenRequest.safeParse(req.body);
        if (!body.success) {
          throw validationFailed('Token request is not valid', fieldErrorsFromZod(body.error));
        }

        const principal = config.principals.find(
          (candidate) => candidate.sub === body.data.subject,
        );
        const secretOk = secretMatches(body.data.secret, config.tokenMintSecret);

        // One message for both failures. Telling them apart would turn this
        // endpoint into a directory of valid subjects.
        if (principal === undefined || !secretOk) {
          throw unauthorized('Unknown subject, or the secret is wrong');
        }

        const { token, expiresIn } = await signToken(principal, config.jwtSecret);

        res.json(
          TokenResponse.parse({
            token,
            tokenType: 'Bearer',
            expiresIn,
            subject: principal.sub,
            name: principal.name,
            roles: principal.roles,
            permissions: permissionsFor(principal.roles),
          }),
        );
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/me', (req, res) => {
    const caller = req.caller;
    res.json(
      MeResponse.parse({
        authenticated: caller?.authenticated ?? false,
        subject: caller?.subject ?? null,
        name: caller?.name ?? null,
        roles: caller?.roles ?? [],
        permissions: caller?.permissions ?? [],
      }),
    );
  });

  return router;
}
