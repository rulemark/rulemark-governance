import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/** Starting the receiver as a real process: configuration, health, SIGTERM. */
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
export const DIST_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

export const SOURCE_ARGS = ['--import', 'tsx', '--conditions=development', SOURCE_ENTRY];
export const DIST_ARGS = [DIST_ENTRY];

export interface Running {
  readonly child: ChildProcess;
  output(): string;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      probe.close(() => resolve(address.port));
    });
  });
}

export function start(args: string[], env: Record<string, string>): Running {
  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

export function exitOf(running: Running): Promise<number | null> {
  return new Promise((resolve) => running.child.once('exit', (code) => resolve(code)));
}

export async function waitForHealth(port: number, running: Running): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null) {
      throw new Error(`exited early (${running.child.exitCode})\n${running.output()}`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`never became healthy\n${running.output()}`);
}
