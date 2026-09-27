import { z } from 'zod';

/** The web app's configuration, read from the environment once at startup. */
export interface Config {
  /** Where ropa-api answers, without a trailing slash. */
  ropaApiUrl: string;
}

/** A configuration the app can't run with; the message names the variables. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Another service's address, as the API reads one (`apps/ropa-api`'s
 * config): Render's Blueprint wires it in as `host:port` (`fromService`,
 * `hostport`), which becomes plain http on the private network; a full URL,
 * for local development, is used as given.
 */
const HOST_PORT = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?:\d{1,5}$/;
const serviceAddress = z.string().transform((value, ctx) => {
  if (HOST_PORT.test(value)) return `http://${value}`;
  try {
    if (['http:', 'https:'].includes(new URL(value).protocol)) return value.replace(/\/+$/, '');
  } catch {
    // Neither; reported below.
  }
  ctx.addIssue({ code: 'custom', message: 'Must be host:port or an http(s) URL' });
  return z.NEVER;
});

const Environment = z.object({
  ROPA_API_URL: z.string({ error: 'Required' }).min(1, 'Required').pipe(serviceAddress),
});

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const parsed = Environment.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return { ropaApiUrl: parsed.data.ROPA_API_URL };
}
