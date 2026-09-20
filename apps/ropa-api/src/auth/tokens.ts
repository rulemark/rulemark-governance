import { randomUUID } from 'node:crypto';
import { Principal } from '@rulemark/ropa-schemas';
import { SignJWT, errors, jwtVerify } from 'jose';

import { unauthorized } from '../shared/problems.js';

/**
 * HS256 tokens (`ropa-api.md` §1.9). Symmetric signing is right here: one
 * service both mints and verifies, and rotating `JWT_SECRET` simply invalidates
 * every existing token, which is acceptable for a demo.
 */

export const TOKEN_ISSUER = 'ropa';
export const TOKEN_AUDIENCE = 'ropa-api';

/** Eight hours: the "automatic logoff" control from Render's HIPAA guidance. */
export const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;

export interface TokenClaims extends Principal {
  readonly jti: string;
  readonly exp: number;
}

export interface SignOptions {
  readonly lifetimeSeconds?: number;
  readonly audience?: string;
}

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(
  principal: Principal,
  secret: string,
  options: SignOptions = {},
): Promise<{ token: string; expiresIn: number }> {
  const lifetime = options.lifetimeSeconds ?? TOKEN_LIFETIME_SECONDS;
  const issuedAt = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({ name: principal.name, roles: principal.roles })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(principal.sub)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(options.audience ?? TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    // A per-token id, so a specific token can be traced through the logs.
    .setJti(randomUUID())
    .setExpirationTime(issuedAt + lifetime)
    .sign(keyFrom(secret));

  return { token, expiresIn: lifetime };
}

export async function verifyToken(token: string, secret: string): Promise<TokenClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keyFrom(secret), {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw unauthorized('This token has expired. Mint a new one at POST /v1/tokens');
    }
    throw unauthorized('This token is not valid');
  }

  // The claims are validated, not trusted. Roles arrive inside the token, so a
  // token minted by an older or buggier version must not smuggle in a role the
  // permission map has never heard of.
  const principal = Principal.safeParse({
    sub: payload.sub,
    name: payload['name'],
    roles: payload['roles'],
  });
  if (!principal.success) {
    throw unauthorized('This token does not carry a subject and roles we recognise');
  }

  return {
    ...principal.data,
    jti: typeof payload.jti === 'string' ? payload.jti : '',
    exp: payload.exp ?? 0,
  };
}
