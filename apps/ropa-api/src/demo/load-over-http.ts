import { API_VERSION, Activity, inputFromActivity } from '@rulemark/ropa-schemas';

import { DEMO_AGREEMENTS, DEMO_RECORDS, type DemoAgreement, type DemoRecord } from './dataset.js';
import {
  STORY_ACTIVITIES,
  STORY_EDITS,
  type StoryActivity,
  type StoryEdit,
  type StoryLookup,
} from './story.js';

/**
 * `demo:data`: the Hireloop story loaded **through the API**, the way any
 * other client would, which is also a real smoke test of a deployment.
 *
 * Everything is stamped now. Backdating is deliberately not exposed over HTTP;
 * `db:seed` replays the timeline through the domain layer instead.
 *
 * Idempotent by lookup: records by slug, agreements by the pair they join,
 * activities by name, edits by their change note in the activity's history.
 * Activities are matched by name rather than code because over HTTP the
 * server allocates codes, and a create cannot be taken back: on a service
 * that already holds other activities, the story's P1 may be P5.
 */

export interface Outcome {
  readonly label: string;
  readonly status: 'created' | 'exists' | 'failed';
  readonly detail?: string;
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
  readonly etag: string | null;
}

type Body = Record<string, unknown>;

export async function mintToken(baseUrl: string, subject: string, secret: string): Promise<string> {
  const response = await fetch(`${baseUrl}/${API_VERSION}/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, secret }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not mint a token for "${subject}" (${response.status}). ` +
        `Add it to PRINCIPALS with the admin role, or set DEMO_SUBJECT.`,
    );
  }
  return ((await response.json()) as { token: string }).token;
}

function describeProblem(reply: Reply): string {
  const problem = reply.body as { detail?: string; errors?: { path: string; message: string }[] };
  const fields = (problem.errors ?? []).map((error) => `${error.path} ${error.message}`).join('; ');
  return [String(reply.status), problem.detail, fields].filter(Boolean).join(' — ');
}

export async function loadDemoData(
  baseUrl: string,
  token: string,
  log: (outcome: Outcome) => void = () => undefined,
): Promise<Outcome[]> {
  async function call(
    method: string,
    path: string,
    body?: unknown,
    version?: number,
  ): Promise<Reply> {
    const response = await fetch(`${baseUrl}/${API_VERSION}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
      etag: response.headers.get('etag'),
    };
  }

  /** Every page of a list, following `nextCursor` (§1.3). */
  async function all<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | null = null;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const reply = await call(
        'GET',
        `${path}${separator}limit=200${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      const page = reply.body as { data: T[]; nextCursor: string | null };
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return rows;
  }

  const outcomes: Outcome[] = [];
  const record = (outcome: Outcome) => {
    outcomes.push(outcome);
    log(outcome);
  };
  const created = (label: string, reply: Reply, ok: number): Outcome =>
    reply.status === ok
      ? { label, status: 'created' }
      : { label, status: 'failed', detail: describeProblem(reply) };

  // --- the foundation records, in dependency order ---

  async function ensure(entry: DemoRecord): Promise<Outcome> {
    const label = `${entry.path}/${entry.slug}`;
    if ((await call('GET', `${entry.path}/${entry.slug}`)).status === 200) {
      return { label, status: 'exists' };
    }
    return created(label, await call('POST', entry.path, entry.body), 201);
  }

  async function ensureAgreement(entry: DemoAgreement): Promise<Outcome> {
    const label = `agreements/${entry.party}+${entry.terms}`;
    const search = new URLSearchParams({ party: entry.party, terms: entry.terms });
    const existing = await call('GET', `agreements?${search.toString()}`);
    if (existing.status === 200 && (existing.body as { data: unknown[] }).data.length > 0) {
      return { label, status: 'exists' };
    }
    const { since: _since, ...body } = entry;
    return created(label, await call('POST', 'agreements', body), 201);
  }

  // Sequential on purpose: a record must not be created before the one it
  // references, and the order in the dataset is the dependency order.
  for (const entry of DEMO_RECORDS) record(await ensure(entry));
  for (const entry of DEMO_AGREEMENTS) record(await ensureAgreement(entry));

  // --- the activities, in story order ---

  type Listed = { code: string; name: string; status: string; version: number };
  const nameOf = new Map(
    STORY_ACTIVITIES.map((story) => [story.code, String(story.input['name'])]),
  );
  const find = async (storyCode: string) =>
    (await all<Listed>('activities')).find((row) => row.name === nameOf.get(storyCode));

  async function lookup(): Promise<StoryLookup> {
    const parties = await all<{ id: string; slug: string }>('parties');
    const agreements = await all<{
      id: string;
      party: { slug?: string };
      terms: { slug?: string };
    }>('agreements');
    const required = <T>(value: T | undefined, what: string): T => {
      if (value === undefined) throw new Error(`The story needs ${what}, which is not there`);
      return value;
    };
    return {
      party: (slug) => required(parties.find((row) => row.slug === slug)?.id, `party "${slug}"`),
      agreement: (party, terms) =>
        required(
          agreements.find((row) => row.party.slug === party && row.terms.slug === terms)?.id,
          `an agreement between ${party} and ${terms}`,
        ),
    };
  }

  async function create(story: StoryActivity): Promise<Outcome> {
    const label = `${story.code} created`;
    if ((await find(story.code)) !== undefined) return { label, status: 'exists' };
    const reply = await call('POST', 'activities', {
      ...story.input,
      changeNote: story.changeNote,
    });
    return created(label, reply, 201);
  }

  async function activate(story: StoryActivity): Promise<Outcome> {
    const label = `${story.code} activated`;
    const current = await find(story.code);
    if (current === undefined) return { label, status: 'failed', detail: 'not created' };
    if (current.status !== 'draft') return { label, status: 'exists' };
    const reply = await call(
      'POST',
      `activities/${current.code}/activate`,
      { changeNote: 'Reviewed and approved' },
      current.version,
    );
    return created(label, reply, 200);
  }

  async function edit(story: StoryEdit): Promise<Outcome> {
    const label = `${story.code} ${story.changeNote}`;
    const current = await find(story.code);
    if (current === undefined) return { label, status: 'failed', detail: 'not created' };

    const history = await call('GET', `activities/${current.code}/revisions`);
    const notes = (history.body as { data: { changeNote: string | null }[] }).data.map(
      (entry) => entry.changeNote,
    );
    if (notes.includes(story.changeNote)) return { label, status: 'exists' };

    // Read, change what the story changes, send the rest back (§1.4).
    const read = await call('GET', `activities/${current.code}`);
    const activity = Activity.parse(read.body);
    const body: Body = story.edit(inputFromActivity(activity), await lookup());
    const reply = await call(
      'PUT',
      `activities/${current.code}`,
      { ...body, changeNote: story.changeNote },
      activity.version,
    );
    return created(label, reply, 200);
  }

  const steps = [
    ...STORY_ACTIVITIES.flatMap((story) => [
      { at: story.created, run: () => create(story) },
      { at: story.activated, run: () => activate(story) },
    ]),
    ...STORY_EDITS.map((story) => ({ at: story.at, run: () => edit(story) })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const step of steps) record(await step.run());
  return outcomes;
}
