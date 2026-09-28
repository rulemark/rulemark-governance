import { afterEach, describe, expect, it } from 'vitest';

import {
  RopaConflictError,
  RopaError,
  RopaNotFoundError,
  RopaPreconditionError,
  RopaResponseError,
  RopaValidationError,
  createRopaClient,
  type ActivityListQuery,
} from './index.ts';
import { P3, problem, stubApi } from './test-support.ts';

let api: Awaited<ReturnType<typeof stubApi>> | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('activities.list', () => {
  it('reads one page of the record', async () => {
    api = await stubApi(() => ({ body: { data: [P3], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url });

    const page = await ropa.activities.list();

    expect(page).toEqual({ data: [P3], nextCursor: null });
    expect(api.received[0]).toMatchObject({ method: 'GET', url: '/v1/activities' });
    expect(api.received[0]?.headers.accept).toBe('application/json');
  });

  it('sends the filters and paging it is given, and none it is not', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url });

    await ropa.activities.list({ role: 'processor', party: 'mailcrest', limit: 10, cursor: 'abc' });

    expect(api.received[0]?.url).toBe(
      '/v1/activities?role=processor&party=mailcrest&limit=10&cursor=abc',
    );
  });

  // A page builds its query from the URL, where a filter may be missing.
  it('leaves out a filter set to undefined', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url });
    const fromTheUrl: Record<string, string | undefined> = { role: undefined, status: 'active' };

    await ropa.activities.list(fromTheUrl as ActivityListQuery);

    expect(api.received[0]?.url).toBe('/v1/activities?status=active');
  });

  it('takes a base URL with a path, as the browser does (/api/ropa)', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: `${api.url}/api/ropa/` });

    await ropa.activities.list();

    expect(api.received[0]?.url).toBe('/api/ropa/v1/activities');
  });

  // `fetch` accepts a relative URL in the browser, not in Node: the client
  // must hand it the base URL as given (ropa-packages.md §8.1).
  it('leaves a relative base URL relative', async () => {
    const urls: string[] = [];
    const ropa = createRopaClient({
      baseUrl: '/api/ropa',
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json({ data: [], nextCursor: null });
      },
    });

    await ropa.activities.list({ status: 'active' });

    expect(urls).toEqual(['/api/ropa/v1/activities?status=active']);
  });
});

describe('validation', () => {
  it('fails loudly when the API no longer matches the package', async () => {
    api = await stubApi(() => ({
      body: { data: [{ ...P3, status: 'archived' }], nextCursor: null },
    }));
    const ropa = createRopaClient({ baseUrl: api.url });

    const error = await ropa.activities.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RopaResponseError);
    expect((error as RopaResponseError).issues[0]?.path).toEqual(['data', 0, 'status']);
  });

  it('can be switched off', async () => {
    const body = { data: [{ ...P3, status: 'archived' }], nextCursor: null };
    api = await stubApi(() => ({ body }));
    const ropa = createRopaClient({ baseUrl: api.url, validate: false });

    expect(await ropa.activities.list()).toEqual(body);
  });
});

// ropa-packages.md §5.3: problem+json becomes a typed error.
describe('errors', () => {
  it.each([
    [404, 'not-found', 'Resource not found', RopaNotFoundError],
    [409, 'conflict', 'Conflict', RopaConflictError],
    [412, 'version-mismatch', 'Version mismatch', RopaPreconditionError],
    [428, 'if-match-required', 'If-Match header required', RopaPreconditionError],
    [403, 'forbidden', 'Permission denied', RopaError],
    [500, 'internal', 'Internal Server Error', RopaError],
  ] as const)('%i becomes %s', async (status, type, title, Kind) => {
    api = await stubApi(() => problem(status, type, title, { detail: 'Because.' }));
    const ropa = createRopaClient({ baseUrl: api.url });

    const error = await ropa.activities.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Kind);
    expect(error).toBeInstanceOf(RopaError);
    expect(error).toMatchObject({
      status,
      message: 'Because.',
      problem: { type: `https://ropa.example/problems/${type}`, title, status },
    });
  });

  it("gives a validation error's field errors, ready for a form", async () => {
    const errors = [
      { path: '/party', code: 'unknown_reference', message: 'No party matching "x"' },
    ];
    api = await stubApi(() => problem(422, 'validation', 'Invalid filter', { errors }));
    const ropa = createRopaClient({ baseUrl: api.url });

    const error = await ropa.activities.list({ party: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RopaValidationError);
    expect((error as RopaValidationError).errors).toEqual(errors);
  });

  it('keeps extension members, such as the current version on a 412', async () => {
    api = await stubApi(() =>
      problem(412, 'version-mismatch', 'Version mismatch', { currentVersion: 4 }),
    );
    const ropa = createRopaClient({ baseUrl: api.url });

    const error = (await ropa.activities.list().catch((e: unknown) => e)) as RopaError;

    expect(error.problem['currentVersion']).toBe(4);
  });

  // A proxy or load balancer in between answers in its own words.
  it('still gives a RopaError when the body is not a problem', async () => {
    api = await stubApi(() => ({
      status: 502,
      headers: { 'content-type': 'text/html' },
      body: '<h1>Bad gateway</h1>',
    }));
    const ropa = createRopaClient({ baseUrl: api.url });

    const error = await ropa.activities.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RopaError);
    expect(error).toMatchObject({ status: 502, problem: { status: 502, title: 'Bad Gateway' } });
  });
});

describe('the token', () => {
  it('is sent as a bearer token', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url, token: 'abc.def.ghi' });

    await ropa.activities.list();

    expect(api.received[0]?.headers.authorization).toBe('Bearer abc.def.ghi');
  });

  it('can come from a provider, asked on every call', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    let calls = 0;
    const ropa = createRopaClient({
      baseUrl: api.url,
      token: async () => `token-${++calls}`,
    });

    await ropa.activities.list();
    await ropa.activities.list();

    expect(api.received.map((r) => r.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  // The browser's instance has none: the proxy holds it (§8.1).
  it('is left out when there is none', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url, token: async () => undefined });

    await ropa.activities.list();

    expect(api.received[0]?.headers).not.toHaveProperty('authorization');
  });
});

describe('cancellation', () => {
  it('stops a call when its signal aborts', async () => {
    api = await stubApi(() => ({ body: { data: [], nextCursor: null } }));
    const ropa = createRopaClient({ baseUrl: api.url });
    const controller = new AbortController();
    controller.abort();

    await expect(ropa.activities.list({}, { signal: controller.signal })).rejects.toThrow(/abort/i);
  });
});
