import { afterEach, describe, expect, it, vi } from 'vitest';

import { register } from './instrumentation';

// Next calls register() once as a server starts: a misconfigured service
// stops there, with the variable to fix, rather than failing requests later.
describe('register', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function capture() {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return { exit, stderr };
  }

  it('stops the server, naming the variable, when the configuration is wrong', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('ROPA_API_URL', '');
    const { exit, stderr } = capture();

    await register();

    expect(exit).toHaveBeenCalledWith(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/ROPA_API_URL/);
  });

  it('lets a well-configured server start', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('ROPA_API_URL', 'http://localhost:3000');
    const { exit } = capture();

    await register();

    expect(exit).not.toHaveBeenCalled();
  });

  it('does nothing in the edge runtime, where there is no process to stop', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('ROPA_API_URL', '');
    const { exit } = capture();

    await register();

    expect(exit).not.toHaveBeenCalled();
  });
});
