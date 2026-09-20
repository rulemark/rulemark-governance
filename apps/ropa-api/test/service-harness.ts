import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * Starting the service as a real process, for the things `createApp` cannot
 * cover: failing fast on bad configuration, shutting down when Render sends
 * SIGTERM, and whether the built artifact can be loaded at all.
 *
 * Paths are resolved from this file, not from `process.cwd()`, which differs
 * between `npm test -w apps/ropa-api` and a run from the repository root.
 */
export const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCE_ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
export const DIST_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

/** The sources, through tsx, with workspace packages resolved to their sources. */
export const SOURCE_ARGS = ['--import', 'tsx', '--conditions=development', SOURCE_ENTRY];

/** The built artifact, exactly as Render runs it. */
export const DIST_ARGS = [DIST_ENTRY];

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      probe.close(() => {
        resolve(address.port);
      });
    });
  });
}

export interface RunningService {
  readonly child: ChildProcess;
  /** Everything the process has written to stderr so far. */
  stderr(): string;
}

/**
 * Everything the service needs to boot. Passed explicitly rather than inherited,
 * so a test behaves the same whether or not the developer has a `.env`, and the
 * same in CI as on a laptop.
 */
const BASE_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://ropa:ropa@localhost:5432/ropa',
};

export function startService(args: string[], env: Record<string, string> = {}): RunningService {
  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: { ...process.env, ...BASE_ENV, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return { child, stderr: () => stderr };
}

export function exitOf(service: RunningService): Promise<number | null> {
  return new Promise((resolve) => {
    service.child.once('exit', (code) => {
      resolve(code);
    });
  });
}

export async function waitForHealth(port: number, service: RunningService): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // A process that died on startup will never become healthy, and its stderr
    // is the only thing that explains why.
    if (service.child.exitCode !== null) {
      throw new Error(`service exited early (${service.child.exitCode})\n${service.stderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`service never became healthy\n${service.stderr()}`);
}
