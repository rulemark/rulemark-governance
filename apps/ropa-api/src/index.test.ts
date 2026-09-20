import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * These drive the real bootstrap in a child process: the parts `createApp`
 * cannot cover are exactly the parts that only exist once there is a process
 * and a socket — failing fast on bad configuration, and shutting down cleanly
 * when Render sends SIGTERM.
 */

function freePort(): Promise<number> {
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

// Resolved from this file, not from `process.cwd()`: the working directory
// differs between `npm test -w apps/ropa-api` and a run from the repository root.
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));

function startService(env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx', '--conditions=development', ENTRY], {
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function exitOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
}

async function waitForHealth(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service exited early (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('service never became healthy');
}

let running: ChildProcess | undefined;

afterEach(() => {
  running?.kill('SIGKILL');
  running = undefined;
});

describe('service bootstrap', () => {
  it('listens, serves the health check, and exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    const child = startService({ PORT: String(port) });
    running = child;

    await waitForHealth(port, child);

    const exited = exitOf(child);
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  }, 20_000);

  it('refuses to start on invalid configuration, naming the variable', async () => {
    const child = startService({ PORT: 'abc' });
    running = child;

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    expect(await exitOf(child)).toBe(1);
    expect(stderr).toMatch(/PORT/);
  }, 20_000);
});
