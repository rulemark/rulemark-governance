import { Principal } from '@rulemark/ropa-schemas';
import { z } from 'zod';

/**
 * The service's environment, validated once at startup and never read from
 * `process.env` again. A missing or malformed variable stops the process with a
 * message naming it, rather than surfacing later as a 500
 * (workspace-skeleton.md §3.4).
 *
 * Variables are added to this schema by the phase that first uses them, so
 * `npm run dev` never demands configuration for a feature that does not exist
 */
const PostgresUrl = z.string().refine((value) => {
  // A connection string, not a bare host:port, and not a URL for a different
  // database that happens to parse: a pasted MySQL or Redis URL is a likelier
  // mistake than a malformed one.
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'Must be a postgres:// or postgresql:// connection string');

/** `.env` and Render's dashboard both hold strings; booleans are spelled out. */
const Flag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .describe('true or false');

/**
 * The known subjects, as JSON (§1.9). There is no user table; the upgrade path
 * is a `principal` table (DM §11, F5).
 */
const Principals = z.string().transform((value, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Must be a JSON array of principals' });
    return z.NEVER;
  }

  const result = z.array(Principal).min(1).safeParse(parsed);
  if (!result.success) {
    ctx.addIssue({ code: 'custom', message: result.error.issues[0]?.message ?? 'Invalid' });
    return z.NEVER;
  }

  // Two entries with one subject would make a minted token ambiguous: which
  // set of roles did the caller get?
  const subjects = new Set(result.data.map((principal) => principal.sub));
  if (subjects.size !== result.data.length) {
    ctx.addIssue({ code: 'custom', message: 'Each subject may appear only once' });
    return z.NEVER;
  }

  return result.data;
});

/**
 * Long enough that guessing is not a strategy. Render's Blueprint generates
 * these with `generateValue: true`, so they never appear in the repository.
 */
const Secret = z.string().min(16, 'Must be at least 16 characters');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: PostgresUrl,
    JWT_SECRET: Secret,
    TOKEN_MINT_SECRET: Secret,
    PRINCIPALS: Principals,
    /** Close the public demo's readable-by-anyone default (§1.9). */
    REQUIRE_AUTH_FOR_READS: Flag.default(false),
    /** Development only: skips verification and honours `X-Actor` (§1.6). */
    AUTH_DISABLED: Flag.default(false),
  })
  .superRefine((env, ctx) => {
    // With auth disabled the actor comes from a header, so anyone could claim
    // to be anyone in the history. That is a development convenience, and the
    // Chapter 8 regulator scene depends on it never being a deployment.
    if (env.AUTH_DISABLED && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DISABLED'],
        message: 'Cannot be true when NODE_ENV is production',
      });
    }
  });

/**
 * The variables with no default, which a deployment must therefore supply.
 * `.env.example` is checked against this list so the two cannot drift.
 */
export const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'TOKEN_MINT_SECRET',
  'PRINCIPALS',
] as const;

export type LogLevel = z.infer<typeof EnvSchema>['LOG_LEVEL'];
export type NodeEnv = z.infer<typeof EnvSchema>['NODE_ENV'];

export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly tokenMintSecret: string;
  readonly principals: readonly Principal[];
  readonly requireAuthForReads: boolean;
  readonly authDisabled: boolean;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * A variable set to whitespace is treated as unset. `.env` files and Render's
 * dashboard both make it easy to leave a key with an empty value, and inheriting
 * the default is friendlier than failing on an invisible character.
 */
function withoutBlanks(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const result = EnvSchema.safeParse(withoutBlanks(env));

  if (!result.success) {
    // Every problem at once: fixing one variable per restart is miserable.
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    databaseUrl: result.data.DATABASE_URL,
    jwtSecret: result.data.JWT_SECRET,
    tokenMintSecret: result.data.TOKEN_MINT_SECRET,
    principals: result.data.PRINCIPALS,
    requireAuthForReads: result.data.REQUIRE_AUTH_FOR_READS,
    authDisabled: result.data.AUTH_DISABLED,
  };
}
