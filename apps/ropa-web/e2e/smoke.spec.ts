import { expect, test } from '@playwright/test';

// Interface step 1's smoke test: the web app and the API, both built, the
// story replayed. What it proves is the path from the browser to the record.

const STORY = [
  ['C1', 'Hireloop staff administration'],
  ['C2', 'Customer accounts & billing'],
  ['C3', 'Hireloop sales & marketing (prospective customers)'],
  ['C4', 'Service reliability monitoring'],
  ['P1', 'Candidate application management'],
  ['P2', 'Diversity & accommodations module'],
  ['P3', 'CV parsing'],
];

test('the home page lists the record’s activities', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Processing activities · Rulemark');
  const table = page.getByRole('table', { name: 'Processing activities' });
  for (const [code, name] of STORY) {
    await expect(table.getByRole('row', { name: new RegExp(`^${code} `) })).toContainText(name!);
  }
  await expect(table.getByRole('row')).toHaveCount(STORY.length + 1);
});

// The server prefetches from the API directly: the rows are in the HTML.
test('the activities are in the first paint, before any script runs', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto('/');

  await expect(page.getByRole('cell', { name: 'CV parsing' })).toBeVisible();
  await context.close();
});

// The browser's way to the API: the rewrite on this app's origin.
test('the browser reads the record through /api/ropa', async ({ request }) => {
  const response = await request.get('/api/ropa/v1/activities?role=processor');

  expect(response.status()).toBe(200);
  const { data } = (await response.json()) as { data: { code: string }[] };
  expect(data.map((activity) => activity.code)).toEqual(['P1', 'P2', 'P3']);
});

test('a write is refused until sign-in, and changes nothing', async ({ request }) => {
  const before = await request.get('/api/ropa/v1/activities/P3');
  const etag = before.headers()['etag']!;

  const write = await request.put('/api/ropa/v1/activities/P3', {
    headers: { 'if-match': etag },
    data: { name: 'Changed without signing in' },
  });

  expect(write.status()).toBe(401);
  expect(write.headers()['content-type']).toMatch(/^application\/problem\+json/);
  expect(await write.json()).toMatchObject({ status: 401, title: 'Authentication required' });
  const after = await request.get('/api/ropa/v1/activities/P3');
  expect(after.headers()['etag']).toBe(etag);
  expect(((await after.json()) as { name: string }).name).toBe('CV parsing');
});

test('only the API’s resources are reachable through the rewrite', async ({ request }) => {
  expect((await request.get('/api/ropa/healthz')).status()).toBe(404);
});

test('the web app answers its health check', async ({ request }) => {
  const response = await request.get('/healthz');

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
});
