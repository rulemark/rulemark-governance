import {
  API_VERSION,
  CloseReviewItemInput,
  ReviewItemInput,
  ReviewItemsQuery,
} from '@rulemark/ropa-schemas';
import { and, asc, eq, gt, isNotNull, lt, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import type { z } from 'zod';

import type { Database } from '../../db/client.js';
import { reviewItem } from '../../db/schema/workflow.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { decodeCursor, pageOf, parsePaging } from '../../domain/pagination.js';
import {
  closeReviewItem,
  findTarget,
  openReviewItem,
  reviewItemIdentity,
  targetColumn,
  toReviewItemOutputs,
  type ReviewItemRow,
} from '../../domain/review-items.js';
import type { Transaction } from '../../domain/transaction.js';
import {
  badRequest,
  fieldErrorsFromZod,
  notFound,
  validationFailed,
} from '../../shared/problems.js';
import { actorFor } from '../middleware/authenticate.js';
import { requires } from '../middleware/authorize.js';

/**
 * Review items (`ropa-api.md` §2 workflow). Their own router rather than a
 * `ResourceDefinition`: that one is built for versioned records, with ETags,
 * `PUT`, `DELETE`, `If-Match` and revisions, and review items have none of
 * those. What they share with the records — identifiers, paging, problem
 * shapes, permissions — is reused as is.
 */

const PATH = `/${API_VERSION}/review-items`;

/** Express 5 types a route parameter as possibly repeated; ours never are. */
function refOf(req: Request): string {
  const value = req.params['ref'];
  if (typeof value !== 'string' || value === '') throw badRequest('This route needs a ref');
  return value;
}

async function find(tx: Transaction, ref: string): Promise<ReviewItemRow> {
  const row = await findByIdentifier<ReviewItemRow>(tx, reviewItemIdentity, ref);
  if (row === undefined) throw notFound(`No review item matching "${ref}"`);
  return row;
}

/** `?status=` and friends, validated, as conditions (§1.3, §2). */
async function filtersOf(tx: Transaction, req: Request): Promise<SQL[]> {
  const raw = Object.fromEntries(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' && value !== '' ? [[key, value]] : [],
    ),
  );
  const parsed = ReviewItemsQuery.safeParse(raw);
  if (!parsed.success) {
    throw validationFailed('This filter is not valid', fieldErrorsFromZod(parsed.error));
  }
  const query = parsed.data;

  const conditions: SQL[] = [];
  if (query.status !== undefined) conditions.push(eq(reviewItem.status, query.status));
  if (query.source !== undefined) conditions.push(eq(reviewItem.source, query.source));
  if (query.reason !== undefined) conditions.push(eq(reviewItem.reason, query.reason));
  if (query.dueBefore !== undefined) conditions.push(lt(reviewItem.dueAt, query.dueBefore));

  if (query.targetType !== undefined) {
    const column = targetColumn(query.targetType);
    if (query.target === undefined) {
      conditions.push(isNotNull(column));
    } else {
      const id = await findTarget(tx, query.targetType, query.target);
      if (id === undefined) {
        throw validationFailed('This filter refers to something that does not exist', [
          {
            path: '/target',
            code: 'unknown_reference',
            message: `No ${query.targetType} matching "${query.target}"`,
          },
        ]);
      }
      conditions.push(eq(column, id));
    }
  }

  return conditions;
}

/** A write's body, validated. A close may arrive with no body at all. */
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw validationFailed(
      'This review item request is not valid',
      fieldErrorsFromZod(parsed.error),
    );
  }
  return parsed.data;
}

export function reviewItemsRouter(db: Database): Router {
  const router = Router();

  router.get(PATH, requires('review:read'), (req, res, next) => {
    void (async () => {
      try {
        const { limit, cursor } = parsePaging(req.query);
        const conditions = await filtersOf(db, req);
        if (cursor !== undefined) conditions.push(gt(reviewItem.id, decodeCursor(cursor)));

        const rows = await db
          .select()
          .from(reviewItem)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          // Ids are UUIDv7: creation order, and a stable key for the cursor.
          .orderBy(asc(reviewItem.id))
          .limit(limit + 1);

        const page = pageOf(rows, limit);
        res.json({ data: await toReviewItemOutputs(db, page.data), nextCursor: page.nextCursor });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.post(PATH, requires('review:create'), (req, res, next) => {
    void (async () => {
      try {
        const input = parseBody(ReviewItemInput, req.body);
        const actor = actorFor(req);
        const item = await db.transaction((tx) => openReviewItem(tx, input, { actor }));
        res.status(201).set('Location', `${PATH}/${item.code}`).json(item);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`${PATH}/:ref`, requires('review:read'), (req, res, next) => {
    void (async () => {
      try {
        const row = await find(db, refOf(req));
        const [item] = await toReviewItemOutputs(db, [row]);
        res.json(item);
      } catch (error) {
        next(error);
      }
    })();
  });

  for (const [action, status] of [
    ['resolve', 'resolved'],
    ['dismiss', 'dismissed'],
  ] as const) {
    router.post(`${PATH}/:ref/${action}`, requires('review:resolve'), (req, res, next) => {
      void (async () => {
        try {
          const { resolutionNote } = parseBody(CloseReviewItemInput, req.body);
          const actor = actorFor(req);
          const existing = await find(db, refOf(req));
          const item = await db.transaction((tx) =>
            closeReviewItem(tx, existing.id, status, resolutionNote, { actor }),
          );
          res.json(item);
        } catch (error) {
          next(error);
        }
      })();
    });
  }

  return router;
}
