import { z } from 'zod';

import { PERMISSIONS, ROLES } from '../enums.js';
import { MAX_TEXT, Name } from '../primitives.js';

/**
 * Demo-scale authentication (`ropa-api.md` §1.9): short-lived tokens and
 * role-based permissions. No sessions, no SSO, no user table.
 */

export const Role = z.enum(ROLES);
export const Permission = z.enum(PERMISSIONS);

/** One entry of the `PRINCIPALS` environment variable. */
export const Principal = z.object({
  sub: Name.describe('The subject: "priya.raman", "svc:monitor".'),
  name: Name,
  roles: z.array(Role).min(1),
});

export const TokenRequest = z.object({
  subject: Name,
  secret: z.string().min(1).max(MAX_TEXT).describe('Checked against TOKEN_MINT_SECRET.'),
});

export const TokenResponse = z.object({
  token: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Seconds until the token expires. Eight hours (§1.9). */
  expiresIn: z.number().int().positive(),
  subject: Name,
  name: Name,
  roles: z.array(Role),
  /** What those roles add up to, so a caller need not know the mapping. */
  permissions: z.array(Permission),
});

/** `GET /v1/me`, so a UI can hide the actions it is not allowed to take. */
export const MeResponse = z.object({
  /** False for an anonymous caller, who is treated as a viewer by default. */
  authenticated: z.boolean(),
  subject: Name.nullable(),
  name: Name.nullable(),
  roles: z.array(Role),
  permissions: z.array(Permission),
});

export type Role = z.infer<typeof Role>;
export type Permission = z.infer<typeof Permission>;
export type Principal = z.infer<typeof Principal>;
export type TokenRequest = z.infer<typeof TokenRequest>;
export type TokenResponse = z.infer<typeof TokenResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
