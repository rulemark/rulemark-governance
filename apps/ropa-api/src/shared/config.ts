import { z } from 'zod';

/**
 * The service's environment, validated once at startup and never read from
 * `process.env` again. A missing or malformed variable stops the process with a
 * message naming it, rather than surfacing later as a 500
 * (workspace-skeleton.md §3.4).
 *
 * Variables are added to this schema by the phase that first uses them, so
 * `npm run dev` never demands configuration for a feature that does not exist
 * yet. The auth variables arrive with tokens.
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

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: PostgresUrl,
});

/**
 * The variables with no default, which a deployment must therefore supply.
 * `.env.example` is checked against this list so the two cannot drift.
 */
export const REQUIRED_ENV_VARS = ['DATABASE_URL'] as const;

export type LogLevel = z.infer<typeof EnvSchema>['LOG_LEVEL'];
export type NodeEnv = z.infer<typeof EnvSchema>['NODE_ENV'];

export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
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
  };
}
