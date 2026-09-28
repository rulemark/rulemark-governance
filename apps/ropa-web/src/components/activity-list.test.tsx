import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { makeQueryClient } from '@/lib/query-client';
import { activityKeys } from '@/lib/queries';
import { ActivityList } from './activity-list';

const UUID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';
const ref = (slug: string, name: string) => ({ id: UUID, slug, name });
function activity(code: string, name: string, role: 'controller' | 'processor', status: string) {
  const common = {
    id: UUID,
    version: 1,
    createdAt: '2026-02-10T09:12:00Z',
    updatedAt: '2026-02-10T09:12:00Z',
    code,
    name,
    status,
    description: null,
    owner: 'Priya Raman',
    roleRationale: null,
    supersedes: null,
    subjectCategories: [],
    dataCategories: [],
    systems: [],
    securityMeasures: [],
    reviewDueAt: null,
    startedAt: null,
    endedAt: null,
    engagements: [],
  };
  return role === 'processor'
    ? {
        ...common,
        role,
        offering: ref('ats', 'Applicant tracking'),
        clientCoverage: 'all_enrolled',
        processingCategories: [],
        clientScope: null,
        dpiaSupportRef: null,
      }
    : {
        ...common,
        role,
        purposes: [],
        lawfulBases: [],
        specialConditions: [],
        retentionRules: [],
        dpiaRequired: false,
        dpiaRef: null,
      };
}

const C1 = activity('C1', 'Hireloop staff administration', 'controller', 'active');
const P3 = activity('P3', 'CV parsing', 'processor', 'draft');

/** The browser's fetch, answering the proxy's URL. */
function api(...answers: Response[]) {
  const fetch = vi.spyOn(globalThis, 'fetch');
  for (const answer of answers) fetch.mockResolvedValueOnce(answer);
  return fetch;
}

async function renderList(client = makeQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ActivityList />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActivityList', () => {
  it('reads the record through the proxy', async () => {
    const fetch = api(Response.json({ data: [C1, P3], nextCursor: null }));

    const screen = await renderList();

    await expect
      .element(screen.getByRole('table', { name: 'Processing activities' }))
      .toBeVisible();
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/ropa/v1/activities');
  });

  it('lists each activity with its code, name, role, status and owner', async () => {
    api(Response.json({ data: [C1, P3], nextCursor: null }));

    const screen = await renderList();

    const row = screen.getByRole('row', { name: /P3/ });
    await expect.element(row).toBeVisible();
    expect(
      row
        .getByRole('cell')
        .elements()
        .map((cell) => cell.textContent),
    ).toEqual(['P3', 'CV parsing', 'Processor', 'Draft', 'Priya Raman']);
    await expect.element(screen.getByRole('row', { name: /C1/ })).toMatchTextContent(/Controller/);
  });

  it('shows what the server prefetched at once, without asking again', async () => {
    const fetch = api();
    const client = makeQueryClient();
    client.setQueryData([...activityKeys.all, 'list', {}], { data: [P3], nextCursor: null });

    const screen = await renderList(client);

    await expect.element(screen.getByRole('cell', { name: 'CV parsing' })).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says it is loading, while it is', async () => {
    let answer: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const screen = await renderList();

    await expect.element(screen.getByRole('status')).toMatchTextContent(/Loading/);
    answer(Response.json({ data: [P3], nextCursor: null }));
    await expect.element(screen.getByRole('cell', { name: 'P3' })).toBeVisible();
  });

  it('says so when the record is empty', async () => {
    api(Response.json({ data: [], nextCursor: null }));

    const screen = await renderList();

    await expect.element(screen.getByText('No activities yet.')).toBeVisible();
  });

  // Next answers a plain 500 when the API behind the rewrite is down, after
  // the browser's two retries: the reader gets words, not a status line.
  it("says the API isn't answering when the server fails, and offers another try", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('Internal Server Error', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    const screen = await renderList();

    const alert = screen.getByRole('alert');
    await expect.element(alert, { timeout: 10_000 }).toMatchTextContent(/isn.t answering/);
    await expect.element(alert).not.toMatchTextContent(/Internal Server Error/);
    await expect.element(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it("says what went wrong, in the API's words, and offers another try", async () => {
    api(
      Response.json(
        {
          type: 'https://ropa.example/problems/forbidden',
          title: 'Permission denied',
          status: 403,
          detail: 'This request needs a token with the record:read permission',
        },
        { status: 403, headers: { 'content-type': 'application/problem+json' } },
      ),
      Response.json({ data: [P3], nextCursor: null }),
    );

    const screen = await renderList();

    const alert = screen.getByRole('alert');
    await expect.element(alert).toMatchTextContent(/couldn.t be loaded/);
    await expect.element(alert).toMatchTextContent(/record:read permission/);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect.element(screen.getByRole('cell', { name: 'P3' })).toBeVisible();
  });
});
