import { API_VERSION } from '@rulemark/ropa-schemas';

import { loadConfigOrExit } from '../shared/startup.js';
import { DEMO_AGREEMENTS, DEMO_RECORDS, type DemoRecord } from './dataset.js';

/**
 * Loads demo data **through the API**, the way any other client would.
 *
 * This is not `db:seed` (`ropa-database.md` §9) and does not replace it. The
 * real seed writes through the domain layer so it can backdate `valid_from`
 * and replay the story's timeline; that option is deliberately not exposed over
 * HTTP, so everything created here is stamped now and `asOf` sees one moment.
 *
 * What this can do that `db:seed` cannot is run against a service it has no
 * database access to — a deployed instance, or a Render preview environment —
 * which also makes it a real smoke test of a deployment.
 */

interface Outcome {
  readonly label: string;
  readonly status: 'created' | 'exists' | 'failed';
  readonly detail?: string;
}

const config = loadConfigOrExit();

const baseUrl = (process.env['DEMO_API_URL'] ?? `http://127.0.0.1:${config.port}`).replace(
  /\/$/,
  '',
);
/** Seeding taxonomies needs `taxonomy:write`, which only `admin` carries. */
const subject = process.env['DEMO_SUBJECT'] ?? 'svc:seed';

async function mintToken(): Promise<string> {
  const response = await fetch(`${baseUrl}/${API_VERSION}/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, secret: config.tokenMintSecret }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not mint a token for "${subject}" (${response.status}). ` +
        `Add it to PRINCIPALS with the admin role, or set DEMO_SUBJECT.`,
    );
  }

  return ((await response.json()) as { token: string }).token;
}

function describeProblem(body: unknown, status: number): string {
  const problem = body as { detail?: string; errors?: { path: string; message: string }[] };
  const fields = (problem.errors ?? []).map((error) => `${error.path} ${error.message}`).join('; ');
  return [String(status), problem.detail, fields].filter(Boolean).join(' — ');
}

async function ensure(token: string, record: DemoRecord): Promise<Outcome> {
  const label = `${record.path}/${record.slug}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // Idempotent by lookup, so running this twice changes nothing (§9).
  const existing = await fetch(`${baseUrl}/${API_VERSION}/${record.path}/${record.slug}`, {
    headers,
  });
  if (existing.ok) return { label, status: 'exists' };

  const created = await fetch(`${baseUrl}/${API_VERSION}/${record.path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(record.body),
  });

  if (created.status === 201) return { label, status: 'created' };
  return { label, status: 'failed', detail: describeProblem(await created.json(), created.status) };
}

async function ensureAgreement(
  token: string,
  agreement: (typeof DEMO_AGREEMENTS)[number],
): Promise<Outcome> {
  const label = `agreements/${agreement.party}+${agreement.terms}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  // No slug to look up, so match on the pair the agreement joins.
  const search = new URLSearchParams({ party: agreement.party, terms: agreement.terms });
  const existing = await fetch(`${baseUrl}/${API_VERSION}/agreements?${search.toString()}`, {
    headers,
  });
  if (existing.ok) {
    const page = (await existing.json()) as { data: unknown[] };
    if (page.data.length > 0) return { label, status: 'exists' };
  }

  const created = await fetch(`${baseUrl}/${API_VERSION}/agreements`, {
    method: 'POST',
    headers,
    body: JSON.stringify(agreement),
  });

  if (created.status === 201) return { label, status: 'created' };
  return { label, status: 'failed', detail: describeProblem(await created.json(), created.status) };
}

async function main(): Promise<void> {
  process.stdout.write(`Seeding ${baseUrl} as "${subject}"\n\n`);

  const token = await mintToken();
  const outcomes: Outcome[] = [];

  // Sequential on purpose: a record must not be created before the one it
  // references, and the order in the dataset is the dependency order.
  for (const record of DEMO_RECORDS) outcomes.push(await ensure(token, record));
  for (const agreement of DEMO_AGREEMENTS) outcomes.push(await ensureAgreement(token, agreement));

  for (const outcome of outcomes.filter((entry) => entry.status === 'failed')) {
    process.stdout.write(`  failed  ${outcome.label}\n          ${outcome.detail ?? ''}\n`);
  }

  const count = (status: Outcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;

  process.stdout.write(
    `\n  ${count('created')} created, ${count('exists')} already there, ${count('failed')} failed\n`,
  );

  if (count('failed') > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
