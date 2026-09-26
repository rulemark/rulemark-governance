import { API_VERSION, type Permission } from '@rulemark/ropa-schemas';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { Router, type Request } from 'express';
import type { z } from 'zod';

import type { Database } from '../../db/client.js';
import { revision } from '../../db/schema/history.js';
import {
  createAggregate,
  deleteAggregate,
  updateAggregate,
  type AggregateSpec,
  type RowShape,
  type SaveContext,
} from '../../domain/aggregate.js';
import { etagFor, requireIfMatch } from '../../domain/concurrency.js';
import { findByIdentifier, type Identifiable } from '../../domain/identifiers.js';
import { decodeCursor, pageOf, parsePaging } from '../../domain/pagination.js';
import type { Transaction } from '../../domain/transaction.js';
import { snapshotSchemaFor } from '../../domain/snapshots.js';
import {
  badRequest,
  conflict,
  fieldErrorsFromZod,
  notFound,
  validationFailed,
} from '../../shared/problems.js';
import { actorFor } from '../middleware/authenticate.js';
import { requires } from '../middleware/authorize.js';

/**
 * The six foundation record types differ in their columns and their rules, not
 * in their shape as HTTP resources: all of them list, create, read, replace,
 * delete and expose their history, all under §1.2, §1.3, §1.4 and §1.8. This
 * builds those seven routes from one definition, so a resource declares what is
 * true about *it* and nothing about paging, ETags or problem shapes.
 */

export interface ResourceContext {
  readonly tx: Transaction;
  readonly request: Request;
}

/**
 * A `?name=` filter (§1.3), declared rather than implemented, so the router can
 * apply it and the OpenAPI document can describe it from the same statement.
 * A filter that takes a record accepts any identifier, like a body reference.
 */
export type FilterSpec =
  | {
      readonly name: string;
      readonly kind: 'equals';
      readonly column: PgColumn;
      readonly description: string;
    }
  | {
      readonly name: string;
      readonly kind: 'reference';
      readonly target: Identifiable;
      readonly label: string;
      readonly description: string;
      /**
       * The condition for the record the identifier resolved to: a column
       * equal to its id, or a link that reaches it (`?system=` on activities).
       */
      readonly matches: (id: string) => SQL;
    }
  | {
      /** A value that is checked before use: `?country=US`. */
      readonly name: string;
      readonly kind: 'value';
      readonly schema: z.ZodType<string>;
      readonly description: string;
      readonly matches: (value: string) => SQL;
    }
  | {
      /** Present as `?name=true`, or not at all: `?special=true`. */
      readonly name: string;
      readonly kind: 'flag';
      readonly description: string;
      readonly matches: SQL;
    };

/**
 * A lifecycle transition on one record (`POST /{path}/{ref}/{name}`), such as
 * activating an activity (§3.4). Like a write, it names the version it was
 * based on in `If-Match`; unlike one, it has its own permission.
 */
export interface ActionSpec<TRow> {
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly permission: Permission;
  readonly input: z.ZodType;
  readonly schemaName: string;
  readonly run: (
    context: ResourceContext,
    existing: TRow,
    expectedVersion: number,
    input: unknown,
    save: SaveContext,
  ) => Promise<TRow>;
}

/** Keeps an action's input typed where it is written, and erased in the list. */
export function defineAction<TRow, TInput>(
  action: Omit<ActionSpec<TRow>, 'input' | 'run'> & {
    readonly input: z.ZodType<TInput>;
    readonly run: (
      context: ResourceContext,
      existing: TRow,
      expectedVersion: number,
      input: TInput,
      save: SaveContext,
    ) => Promise<TRow>;
  },
): ActionSpec<TRow> {
  return action as ActionSpec<TRow>;
}

export interface ResourceDefinition<TRow extends RowShape, TSnapshot, TInput> {
  /** The path segment: `parties`, `agreement-terms`, `taxonomy/data-categories`. */
  readonly path: string;
  /** What a problem calls this, in the singular: "party". */
  readonly label: string;
  readonly aggregate: AggregateSpec<TRow, TSnapshot> & Identifiable;
  readonly input: z.ZodType<TInput>;
  readonly permissions: {
    readonly read: Permission;
    readonly write: Permission;
    readonly delete: Permission;
  };
  /**
   * Validated input to column values, resolving any references by identifier
   * and applying the cross-table rules that need the database (`DB §2`).
   * `existing` is present on a replace. A single-row record declares this and
   * the router saves it; an aggregate with nested rows declares `create` and
   * `replace` instead.
   */
  readonly toValues?: (
    context: ResourceContext,
    input: TInput,
    existing?: TRow,
  ) => Promise<Record<string, unknown>>;
  /** The whole save, for an aggregate the generic one cannot write alone. */
  readonly create?: (context: ResourceContext, input: TInput, save: SaveContext) => Promise<TRow>;
  readonly replace?: (
    context: ResourceContext,
    existing: TRow,
    expectedVersion: number,
    input: TInput,
    save: SaveContext,
  ) => Promise<TRow>;
  /** Lifecycle transitions beyond the seven routes (§3.4). */
  readonly actions?: readonly ActionSpec<TRow>[];
  /** Rows to API shape, with references already loaded as Refs. */
  readonly toOutput: (context: ResourceContext, rows: readonly TRow[]) => Promise<unknown[]>;
  /** The response shape, for the OpenAPI document and for parsing on the way out. */
  readonly output: z.ZodType;
  /** What the schemas are called in `components.schemas`. */
  readonly schemaNames: { readonly input: string; readonly output: string };
  /** `?field=` filters (§1.3). */
  readonly filters?: readonly FilterSpec[];
  /** Refuse a delete the database cannot refuse on its own. */
  readonly guardDelete?: (context: ResourceContext, row: TRow) => Promise<void>;
}

/** Express 5 types a route parameter as possibly repeated; ours never are. */
function param(req: Request, name: string): string {
  const value = req.params[name as keyof typeof req.params];
  if (typeof value !== 'string' || value === '') {
    throw badRequest(`This route needs a ${name} in the path`);
  }
  return value;
}

/**
 * `ON DELETE RESTRICT` raises `restrict_violation`; `foreign_key_violation` is
 * what a deferred `NO ACTION` check raises instead. Every foreign key between
 * aggregates is RESTRICT (DB §3) — that is what makes the API's "409 while
 * referenced" work — so both are treated the same here.
 */
const RESTRICT_VIOLATION = '23001';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

interface DatabaseError {
  code?: string;
  table?: string;
  constraint?: string;
}

/** Drizzle wraps driver errors, so the details sit one level down. */
function databaseErrorOf(error: unknown): DatabaseError {
  const candidate = (error ?? {}) as DatabaseError & { cause?: DatabaseError };
  return candidate.code === undefined && candidate.cause !== undefined
    ? candidate.cause
    : candidate;
}

export function resourceRouter<TRow extends RowShape, TSnapshot, TInput>(
  db: Database,
  definition: ResourceDefinition<TRow, TSnapshot, TInput>,
): Router {
  const router = Router();
  const { aggregate, label, path } = definition;

  /** Where the record now lives, by the identifier a person would use (§1.2). */
  const locationOf = (row: TRow): string => {
    const ref = aggregate.toRef(row);
    return `/${API_VERSION}/${path}/${ref.code ?? ref.slug ?? ref.id}`;
  };

  function toValues(): NonNullable<typeof definition.toValues> {
    if (definition.toValues === undefined) {
      throw new Error(`The ${label} resource declares neither toValues nor its own save`);
    }
    return definition.toValues;
  }

  const single = async (context: ResourceContext, row: TRow): Promise<unknown> =>
    (await definition.toOutput(context, [row]))[0];

  /** Resolves `{ref}` — an id, code or slug (§1.2) — or answers 404. */
  async function find(context: ResourceContext, ref: string): Promise<TRow> {
    const row = await findByIdentifier<TRow>(context.tx, aggregate, ref);
    if (row === undefined) throw notFound(`No ${label} matching "${ref}"`);
    return row;
  }

  function parseInput(body: unknown): TInput {
    const parsed = definition.input.safeParse(body);
    if (!parsed.success) {
      throw validationFailed(`This ${label} is not valid`, fieldErrorsFromZod(parsed.error));
    }
    return parsed.data;
  }

  // --- list ---------------------------------------------------------------
  router.get(`/${path}`, requires(definition.permissions.read), (req, res, next) => {
    void (async () => {
      try {
        const context: ResourceContext = { tx: db, request: req };
        const { limit, cursor } = parsePaging(req.query);
        const conditions = await applyFilters(context, definition.filters ?? []);
        if (cursor !== undefined) conditions.push(gt(aggregate.table.id, decodeCursor(cursor)));

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const rows = (await (db.select() as any)
          .from(aggregate.table)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          // Ids are UUIDv7, so this is creation order as well as a stable key.
          .orderBy(asc(aggregate.table.id))
          .limit(limit + 1)) as TRow[];
        /* eslint-enable @typescript-eslint/no-explicit-any */

        const page = pageOf(rows, limit);
        res.json({
          data: await definition.toOutput(context, page.data),
          nextCursor: page.nextCursor,
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  // --- create -------------------------------------------------------------
  router.post(`/${path}`, requires(definition.permissions.write), (req, res, next) => {
    void (async () => {
      try {
        const input = parseInput(req.body);
        const actor = actorFor(req);

        const created = await db.transaction(async (tx) => {
          const context: ResourceContext = { tx, request: req };
          const save: SaveContext = { actor, changeNote: changeNoteOf(input) };
          const row =
            definition.create !== undefined
              ? await definition.create(context, input, save)
              : await createAggregate(tx, aggregate, await toValues()(context, input), save);
          return { row, output: await single(context, row) };
        });

        res
          .status(201)
          .set('ETag', etagFor(created.row.version))
          .set('Location', locationOf(created.row))
          .json(created.output);
      } catch (error) {
        next(toApiError(error, label));
      }
    })();
  });

  // --- read ---------------------------------------------------------------
  router.get(`/${path}/:ref`, requires(definition.permissions.read), (req, res, next) => {
    void (async () => {
      try {
        const context: ResourceContext = { tx: db, request: req };
        const row = await find(context, param(req, 'ref'));
        res.set('ETag', etagFor(row.version)).json(await single(context, row));
      } catch (error) {
        next(error);
      }
    })();
  });

  // --- replace ------------------------------------------------------------
  router.put(`/${path}/:ref`, requires(definition.permissions.write), (req, res, next) => {
    void (async () => {
      try {
        // Read before the transaction only to resolve {ref} to an id; the
        // version check itself happens inside the UPDATE (§1.8).
        const expectedVersion = requireIfMatch(req.get('if-match'));
        const input = parseInput(req.body);
        const actor = actorFor(req);
        const existing = await find({ tx: db, request: req }, param(req, 'ref'));

        const saved = await db.transaction(async (tx) => {
          const context: ResourceContext = { tx, request: req };
          const save: SaveContext = { actor, changeNote: changeNoteOf(input) };
          const row =
            definition.replace !== undefined
              ? await definition.replace(context, existing, expectedVersion, input, save)
              : await updateAggregate(
                  tx,
                  aggregate,
                  existing.id,
                  expectedVersion,
                  await toValues()(context, input, existing),
                  save,
                );
          return { row, output: await single(context, row) };
        });

        res.set('ETag', etagFor(saved.row.version)).json(saved.output);
      } catch (error) {
        next(toApiError(error, label));
      }
    })();
  });

  // --- delete -------------------------------------------------------------
  router.delete(`/${path}/:ref`, requires(definition.permissions.delete), (req, res, next) => {
    void (async () => {
      try {
        const expectedVersion = requireIfMatch(req.get('if-match'));
        const actor = actorFor(req);
        const existing = await find({ tx: db, request: req }, param(req, 'ref'));

        await db.transaction(async (tx) => {
          const context: ResourceContext = { tx, request: req };
          await definition.guardDelete?.(context, existing);
          await deleteAggregate(tx, aggregate, existing.id, expectedVersion, { actor });
        });

        res.status(204).end();
      } catch (error) {
        next(toApiError(error, label));
      }
    })();
  });

  // --- lifecycle actions (§3.4) -------------------------------------------
  for (const action of definition.actions ?? []) {
    router.post(`/${path}/:ref/${action.name}`, requires(action.permission), (req, res, next) => {
      void (async () => {
        try {
          const expectedVersion = requireIfMatch(req.get('if-match'));
          // A transition may carry nothing at all, not even an empty object.
          const parsed = action.input.safeParse(req.body ?? {});
          if (!parsed.success) {
            throw validationFailed(
              `This ${action.name} request is not valid`,
              fieldErrorsFromZod(parsed.error),
            );
          }
          const actor = actorFor(req);
          const existing = await find({ tx: db, request: req }, param(req, 'ref'));

          const done = await db.transaction(async (tx) => {
            const context: ResourceContext = { tx, request: req };
            const row = await action.run(context, existing, expectedVersion, parsed.data, {
              actor,
              changeNote: changeNoteOf(parsed.data),
            });
            return { row, output: await single(context, row) };
          });

          res.set('ETag', etagFor(done.row.version)).json(done.output);
        } catch (error) {
          next(toApiError(error, label));
        }
      })();
    });
  }

  // --- history (§2) -------------------------------------------------------
  router.get(`/${path}/:ref/revisions`, requires('history:read'), (req, res, next) => {
    void (async () => {
      try {
        const context: ResourceContext = { tx: db, request: req };
        const row = await find(context, param(req, 'ref'));

        const revisions = await db
          .select({
            version: revision.version,
            changeType: revision.changeType,
            validFrom: revision.validFrom,
            actor: revision.actor,
            changeNote: revision.changeNote,
          })
          .from(revision)
          .where(and(eq(revision.entityType, aggregate.entityType), eq(revision.entityId, row.id)))
          .orderBy(asc(revision.version));

        res.json({
          data: revisions.map((entry) => ({
            ...entry,
            validFrom: entry.validFrom.toISOString(),
          })),
          nextCursor: null,
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`/${path}/:ref/revisions/:version`, requires('history:read'), (req, res, next) => {
    void (async () => {
      try {
        const context: ResourceContext = { tx: db, request: req };
        const row = await find(context, param(req, 'ref'));
        const version = Number(param(req, 'version'));

        const [entry] = await db
          .select()
          .from(revision)
          .where(
            and(
              eq(revision.entityType, aggregate.entityType),
              eq(revision.entityId, row.id),
              eq(revision.version, version),
            ),
          );

        if (entry === undefined) {
          throw notFound(`This ${label} has no version ${param(req, 'version')}`);
        }

        res.json({
          version: entry.version,
          changeType: entry.changeType,
          validFrom: entry.validFrom.toISOString(),
          actor: entry.actor,
          changeNote: entry.changeNote,
          // Parsed on the way out as well as on the way in (DB §6.2). A stored
          // snapshot that no longer matches its schema is how an aggregate's
          // shape changed without an upgrader, and returning it quietly would
          // hand a caller history that does not mean what it says.
          snapshot: snapshotSchemaFor(aggregate.entityType).parse(entry.snapshot),
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}

/** Turns the declared filters into conditions, resolving any identifiers. */
async function applyFilters(
  context: ResourceContext,
  filters: readonly FilterSpec[],
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  for (const filter of filters) {
    const raw = context.request.query[filter.name];
    // An absent or repeated parameter is treated as absent.
    if (typeof raw !== 'string' || raw === '') continue;

    if (filter.kind === 'equals') {
      conditions.push(eq(filter.column, raw));
      continue;
    }

    if (filter.kind === 'flag') {
      if (raw !== 'true') {
        throw validationFailed('This filter is not valid', [
          {
            path: `/${filter.name}`,
            code: 'invalid_value',
            message: 'Must be "true", or left out',
          },
        ]);
      }
      conditions.push(filter.matches);
      continue;
    }

    if (filter.kind === 'value') {
      const parsed = filter.schema.safeParse(raw);
      if (!parsed.success) {
        throw validationFailed('This filter is not valid', [
          {
            path: `/${filter.name}`,
            code: 'invalid_value',
            message: parsed.error.issues[0]?.message ?? 'Not a valid value',
          },
        ]);
      }
      conditions.push(filter.matches(parsed.data));
      continue;
    }

    const row = await findByIdentifier<{ id: string }>(context.tx, filter.target, raw);
    if (row === undefined) {
      throw validationFailed('This filter refers to something that does not exist', [
        {
          path: `/${filter.name}`,
          code: 'unknown_reference',
          message: `No ${filter.label} matching "${raw}"`,
        },
      ]);
    }
    conditions.push(filter.matches(row.id));
  }

  return conditions;
}

/** `changeNote` is input-only and belongs to the change, not the record (§1.6). */
function changeNoteOf(input: unknown): string | undefined {
  const note = (input as { changeNote?: unknown }).changeNote;
  return typeof note === 'string' ? note : undefined;
}

/**
 * Turns the database's own refusals into the API's vocabulary. A unique index
 * or a foreign key rejecting a write is not an internal error: it is the
 * race-proof version of a rule the API documents (§4).
 */
function toApiError(error: unknown, label: string): unknown {
  const { code, table, constraint } = databaseErrorOf(error);

  if (code === RESTRICT_VIOLATION || code === FOREIGN_KEY_VIOLATION) {
    const referencedBy = table === undefined ? 'another record' : table.replaceAll('_', ' ');
    return conflict(`This ${label} is still referenced by ${referencedBy}`);
  }

  if (code === UNIQUE_VIOLATION) {
    if (constraint === 'party_one_self') {
      return conflict('There is already a self party, and there may only be one');
    }
    return conflict(`Another ${label} already uses that identifier`);
  }

  return error;
}
