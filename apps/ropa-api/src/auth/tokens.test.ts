import type { Principal } from '@rulemark/ropa-schemas';
import { describe, expect, it } from 'vitest';

import { Problem } from '../shared/problems.js';
import { TOKEN_LIFETIME_SECONDS, signToken, verifyToken } from './tokens.js';

const SECRET = 'a-secret-long-enough-for-hs256-signing';
const PRIYA: Principal = {
  sub: 'priya.raman',
  name: 'Priya Raman',
  roles: ['editor', 'approver'],
};

async function catchProblem(run: () => Promise<unknown>): Promise<Problem> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Problem) return error;
    throw error;
  }
  throw new Error('expected a Problem');
}

describe('signToken', () => {
  it('round-trips the subject, name and roles', async () => {
    const { token } = await signToken(PRIYA, SECRET);
    const claims = await verifyToken(token, SECRET);

    expect(claims.sub).toBe('priya.raman');
    expect(claims.name).toBe('Priya Raman');
    expect(claims.roles).toEqual(['editor', 'approver']);
  });

  it('expires eight hours out, the automatic logoff control (§1.9)', async () => {
    const { expiresIn } = await signToken(PRIYA, SECRET);
    expect(expiresIn).toBe(TOKEN_LIFETIME_SECONDS);
    expect(TOKEN_LIFETIME_SECONDS).toBe(8 * 60 * 60);
  });

  it('gives each token its own id, so one can be traced', async () => {
    const first = await verifyToken((await signToken(PRIYA, SECRET)).token, SECRET);
    const second = await verifyToken((await signToken(PRIYA, SECRET)).token, SECRET);
    expect(first.jti).not.toBe(second.jti);
  });
});

describe('verifyToken', () => {
  it('rejects a token signed with a different secret', async () => {
    const { token } = await signToken(PRIYA, SECRET);
    const problem = await catchProblem(() => verifyToken(token, 'a-completely-different-secret'));
    expect(problem.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const { token } = await signToken(PRIYA, SECRET);
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'priya.raman', name: 'Priya', roles: ['admin'] }),
    ).toString('base64url');

    const problem = await catchProblem(() =>
      verifyToken(`${header}.${forged}.${signature}`, SECRET),
    );
    expect(problem.status).toBe(401);
    expect(payload).not.toBe(forged);
  });

  it('rejects an expired token', async () => {
    const { token } = await signToken(PRIYA, SECRET, { lifetimeSeconds: -1 });
    const problem = await catchProblem(() => verifyToken(token, SECRET));
    expect(problem.status).toBe(401);
    expect(problem.detail).toMatch(/expired/i);
  });

  it('rejects a token minted for something else', async () => {
    const { token } = await signToken(PRIYA, SECRET, { audience: 'someone-elses-api' });
    const problem = await catchProblem(() => verifyToken(token, SECRET));
    expect(problem.status).toBe(401);
  });

  it('rejects nonsense', async () => {
    for (const value of ['', 'not-a-token', 'a.b.c']) {
      expect((await catchProblem(() => verifyToken(value, SECRET))).status).toBe(401);
    }
  });

  it('rejects a token whose roles are not roles we know', async () => {
    // Roles come from the token, so a secret holder could invent one; the
    // claims are validated rather than trusted.
    const { token } = await signToken(
      { ...PRIYA, roles: ['superuser'] } as unknown as Principal,
      SECRET,
    );
    expect((await catchProblem(() => verifyToken(token, SECRET))).status).toBe(401);
  });
});
