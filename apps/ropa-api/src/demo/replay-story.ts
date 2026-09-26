import { ActivityInput } from '@rulemark/ropa-schemas';
import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';

import { RESOURCES } from '../api/resources/index.js';
import type { ResourceContext } from '../api/resources/resource-router.js';
import type { Database } from '../db/client.js';
import {
  agreement,
  agreementTerms,
  party,
  processingActivity,
  revision,
} from '../db/schema/index.js';
import { inputFromSnapshot } from '../domain/activity/input.js';
import { activateActivity } from '../domain/activity/lifecycle.js';
import { loadActivitySnapshot } from '../domain/activity/load.js';
import type { ActivitySaveInput } from '../domain/activity/resolve.js';
import { createActivity, replaceActivity } from '../domain/activity/save.js';
import { createAggregate, type SaveContext } from '../domain/aggregate.js';
import { findByIdentifier } from '../domain/identifiers.js';
import type { Transaction } from '../domain/transaction.js';
import {
  DEMO_AGREEMENTS,
  DEMO_RECORDS,
  STORY_START,
  type DemoAgreement,
  type DemoRecord,
} from './dataset.js';
import {
  STORY_ACTIVITIES,
  STORY_EDITS,
  type StoryActivity,
  type StoryEdit,
  type StoryLookup,
} from './story.js';

/**
 * `db:seed` (`ropa-database.md` §9): the Hireloop story replayed in order,
 * February to September 2026, through the same code a request goes through —
 * the resource definitions for foundation records, the activity save and
 * lifecycle for activities — so codes, revisions and every rule behave as in
 * real use. Each save is backdated to its moment in the story (`validFrom`),
 * which is what gives `asOf` and `/changes` a history to show.
 *
 * Every step is its own transaction and checks first whether it has already
 * happened: records by slug, agreements by the pair they join, activities by
 * code, edits by their change note in the revision history. Running it twice
 * changes nothing.
 */

/** Priya owns the record (cast), so the story's saves are hers. */
const ACTOR = 'priya.raman';

export interface ReplayOutcome {
  readonly applied: string[];
  readonly skipped: string[];
}

interface Step {
  readonly at: string;
  readonly label: string;
  readonly run: (tx: Transaction) => Promise<'applied' | 'skipped'>;
}

const context = (at: string, changeNote?: string): SaveContext => ({
  actor: ACTOR,
  changeNote,
  validFrom: new Date(at),
});

/**
 * The resource definitions never read the request when they write; they take
 * a context only so a route can pass one.
 */
const writeContext = (tx: Transaction): ResourceContext => ({ tx, request: {} as Request });

function definitionFor(path: string) {
  const definition = RESOURCES.find((resource) => resource.path === path);
  if (
    definition === undefined ||
    !('toValues' in definition) ||
    definition.toValues === undefined
  ) {
    throw new Error(`No single-row resource at ${path}`);
  }
  return definition as unknown as {
    aggregate: Parameters<typeof createAggregate>[1] & Parameters<typeof findByIdentifier>[1];
    input: { parse: (body: unknown) => unknown };
    toValues: (context: ResourceContext, input: unknown) => Promise<Record<string, unknown>>;
  };
}

function recordStep(record: DemoRecord): Step {
  const at = record.since ?? STORY_START;
  return {
    at,
    label: `${record.path}/${record.slug}`,
    run: async (tx) => {
      const definition = definitionFor(record.path);
      if ((await findByIdentifier(tx, definition.aggregate, record.slug)) !== undefined) {
        return 'skipped';
      }
      const input = definition.input.parse(record.body);
      const values = await definition.toValues(writeContext(tx), input);
      const note = record.body['changeNote'];
      await createAggregate(
        tx,
        definition.aggregate,
        values,
        context(at, typeof note === 'string' ? note : 'Part of the Hireloop story'),
      );
      return 'applied';
    },
  };
}

async function idOfSlug(
  tx: Transaction,
  table: typeof party | typeof agreementTerms,
  slug: string,
) {
  const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.slug, slug));
  if (row === undefined) throw new Error(`The story needs "${slug}", which is not there yet`);
  return row.id;
}

function agreementStep(entry: DemoAgreement): Step {
  const at = entry.since ?? STORY_START;
  return {
    at,
    label: `agreements/${entry.party}+${entry.terms}`,
    run: async (tx) => {
      const partyId = await idOfSlug(tx, party, entry.party);
      const termsId = await idOfSlug(tx, agreementTerms, entry.terms);
      const [existing] = await tx
        .select({ id: agreement.id })
        .from(agreement)
        .where(and(eq(agreement.partyId, partyId), eq(agreement.termsId, termsId)));
      if (existing !== undefined) return 'skipped';

      const definition = definitionFor('agreements');
      const values = await definition.toValues(writeContext(tx), definition.input.parse(entry));
      await createAggregate(tx, definition.aggregate, values, context(at, entry.changeNote));
      return 'applied';
    },
  };
}

function saveable(body: unknown): ActivitySaveInput {
  const input = ActivityInput.parse(body);
  if (input.role === 'joint_controller') throw new Error('The story has no joint controllers');
  return input;
}

async function activityByCode(tx: Transaction, code: string) {
  const [row] = await tx.select().from(processingActivity).where(eq(processingActivity.code, code));
  return row;
}

const RESET_HINT = 'Seed onto an empty record instead: npm run db:seed -- --reset';

function createStep(story: StoryActivity): Step {
  return {
    at: story.created,
    label: `${story.code} created`,
    run: async (tx) => {
      const input = saveable(story.input);
      const existing = await activityByCode(tx, story.code);
      if (existing !== undefined) {
        if (existing.name === input.name) return 'skipped';
        throw new Error(
          `${story.code} is already "${existing.name}", not the story's "${input.name}". ${RESET_HINT}`,
        );
      }
      const row = await createActivity(tx, input, context(story.created, story.changeNote));
      if (row.code !== story.code) {
        // Rolled back with the transaction, so the code is not spent.
        throw new Error(
          `The story's ${story.code} would be saved as ${row.code}: this database already holds other activities. ${RESET_HINT}`,
        );
      }
      return 'applied';
    },
  };
}

function activateStep(story: StoryActivity): Step {
  return {
    at: story.activated,
    label: `${story.code} activated`,
    run: async (tx) => {
      const row = await activityByCode(tx, story.code);
      if (row === undefined) throw new Error(`${story.code} should exist by now`);
      if (row.status !== 'draft') return 'skipped';
      await activateActivity(
        tx,
        row.id,
        row.version,
        context(story.activated, 'Reviewed and approved'),
      );
      return 'applied';
    },
  };
}

async function lookup(tx: Transaction): Promise<StoryLookup> {
  const parties = new Map(
    (await tx.select({ id: party.id, slug: party.slug }).from(party)).map((row) => [
      row.slug,
      row.id,
    ]),
  );
  const agreements = await tx
    .select({ id: agreement.id, party: party.slug, terms: agreementTerms.slug })
    .from(agreement)
    .innerJoin(party, eq(party.id, agreement.partyId))
    .innerJoin(agreementTerms, eq(agreementTerms.id, agreement.termsId));
  const required = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`The story needs ${what}, which is not there yet`);
    return value;
  };
  return {
    party: (slug) => required(parties.get(slug), `party "${slug}"`),
    agreement: (partySlug, termsSlug) =>
      required(
        agreements.find((row) => row.party === partySlug && row.terms === termsSlug)?.id,
        `an agreement between ${partySlug} and ${termsSlug}`,
      ),
  };
}

function editStep(story: StoryEdit): Step {
  return {
    at: story.at,
    label: `${story.code} ${story.changeNote}`,
    run: async (tx) => {
      const row = await activityByCode(tx, story.code);
      if (row === undefined) throw new Error(`${story.code} should exist by now`);
      const [done] = await tx
        .select({ id: revision.id })
        .from(revision)
        .where(
          and(
            eq(revision.entityType, 'activity'),
            eq(revision.entityId, row.id),
            eq(revision.changeNote, story.changeNote),
          ),
        );
      if (done !== undefined) return 'skipped';

      const current = inputFromSnapshot(await loadActivitySnapshot(tx, row));
      const body = story.edit(current, await lookup(tx));
      await replaceActivity(
        tx,
        row.id,
        row.version,
        saveable(body),
        context(story.at, story.changeNote),
      );
      return 'applied';
    },
  };
}

/** Every step, in story order. Steps at the same moment keep their order here. */
export function storyTimeline(): Step[] {
  const steps: Step[] = [
    ...DEMO_RECORDS.map(recordStep),
    ...DEMO_AGREEMENTS.map(agreementStep),
    ...STORY_ACTIVITIES.flatMap((story) => [createStep(story), activateStep(story)]),
    ...STORY_EDITS.map(editStep),
  ];
  // Array.prototype.sort is stable, so dependency order survives within a moment.
  return steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export async function replayStory(
  db: Database,
  log: (line: string) => void = () => undefined,
): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { applied: [], skipped: [] };
  for (const step of storyTimeline()) {
    const result = await db.transaction((tx) => step.run(tx));
    outcome[result].push(step.label);
    log(
      `  ${result === 'applied' ? 'applied' : 'exists '}  ${step.at.slice(0, 10)}  ${step.label}`,
    );
  }
  return outcome;
}

/**
 * Empties the record so the story can start again at C1 (`--reset`, §9):
 * every table but the code counters, which are structure and are restarted
 * instead. `TRUNCATE` does not fire the row triggers that keep revisions
 * append-only, which is exactly why this is a seed-only tool.
 */
export async function resetDatabase(db: Database): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'code_counter'`,
  );
  await db.transaction(async (tx) => {
    if (rows.length > 0) {
      await tx.execute(
        sql`TRUNCATE ${sql.join(
          rows.map((row) => sql.identifier(row.tablename)),
          sql`, `,
        )} CASCADE`,
      );
    }
    await tx.execute(sql`UPDATE code_counter SET last_value = 0`);
  });
}
