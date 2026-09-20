import type { Permission } from '@rulemark/ropa-schemas';
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
} from '../../domain/aggregate.js';
import { etagFor, requireIfMatch } from '../../domain/concurrency.js';
import { findByIdentifier, type Identifiable } from '../../domain/identifiers.js';
import { decodeCursor, pageOf, parsePaging } from '../../domain/pagination.js';
import type { Transaction } from '../../domain/transaction.js';
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
      readonly column: PgColumn;
      readonly target: Identifiable;
      readonly label: string;
      readonly description: string;
    };

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
   * `existing` is present on a replace.
   */
  readonly toValues: (
    context: ResourceContext,
    input: TInput,
    existing?: TRow,
  ) => Promise<Record<string, unknown>>;
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
          const values = await definition.toValues(context, input);
          const row = await createAggregate(tx, aggregate, values, {
            actor,
            changeNote: changeNoteOf(input),
          });
          return { row, output: await single(context, row) };
        });

        res.status(201).set('ETag', etagFor(created.row.version)).json(created.output);
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
          const values = await definition.toValues(context, input, existing);
          const row = await updateAggregate(tx, aggregate, existing.id, expectedVersion, values, {
            actor,
            changeNote: changeNoteOf(input),
          });
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
          snapshot: entry.snapshot,
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
    conditions.push(eq(filter.column, row.id));
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
