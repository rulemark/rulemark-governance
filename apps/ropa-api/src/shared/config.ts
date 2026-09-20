import { z } from 'zod';

/**
 * The service's environment, validated once at startup and never read from
 * `process.env` again. A missing or malformed variable stops the process with a
 * message naming it, rather than surfacing later as a 500
 * (workspace-skeleton.md §3.4).
 *
 * Variables are added to this schema by the phase that first uses them, so
 * `npm run dev` never demands configuration for a feature that does not exist
 * yet. `DATABASE_URL` arrives with Drizzle, the auth variables with tokens.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type LogLevel = z.infer<typeof EnvSchema>['LOG_LEVEL'];
export type NodeEnv = z.infer<typeof EnvSchema>['NODE_ENV'];

export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
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
  };
}
