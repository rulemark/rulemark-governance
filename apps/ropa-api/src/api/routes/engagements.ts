import { API_VERSION, type Activity, type Engagement } from '@rulemark/ropa-schemas';
import { Router } from 'express';

import type { Database } from '../../db/client.js';
import {
  activityAggregate,
  loadActivitySnapshot,
  type ActivityRow,
} from '../../domain/activity/load.js';
import { toActivityOutputs } from '../../domain/activity/output.js';
import { etagFor } from '../../domain/concurrency.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { notFound } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';

/**
 * The engagement sub-resource (`ropa-api.md` §3.5): one vendor on an activity,
 * without the whole activity. Engagements are the activity's own rows, not a
 * record of their own (DM §4), so they are read as the activity holds them:
 * the same shape as `GET /activities/{ref}`, the activity's version as the
 * ETag, and the activity's permission. They have no code or slug, so `{id}`
 * is an id only (DM §3.0).
 */

const ENGAGEMENTS = `/${API_VERSION}/activities/:ref/engagements`;

/**
 * The activity as `GET /activities/{ref}` answers it, with its row for the
 * version. Read in one repeatable-read transaction, so the ETag and the
 * engagements come from the same moment even while someone saves.
 */
async function readActivity(
  db: Database,
  ref: string,
): Promise<{ row: ActivityRow; activity: Activity }> {
  return db.transaction(
    async (tx) => {
      const row = await findByIdentifier<ActivityRow>(tx, activityAggregate, ref);
      if (row === undefined) throw notFound(`No activity matching "${ref}"`);
      const [activity] = await toActivityOutputs(tx, [await loadActivitySnapshot(tx, row)]);
      return { row, activity: activity! };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** One of the activity's engagements, or a 404 naming both. */
function engagementOf(row: ActivityRow, activity: Activity, id: string): Engagement {
  const engagement = activity.engagements.find((candidate) => candidate.id === id);
  if (engagement === undefined) {
    throw notFound(`Activity ${row.code} holds no engagement ${id}`);
  }
  return engagement;
}

export function engagementsRouter(db: Database): Router {
  const router = Router();

  router.get(ENGAGEMENTS, requires('record:read'), (req, res, next) => {
    void (async () => {
      try {
        const { row, activity } = await readActivity(db, String(req.params['ref']));
        res
          .set('ETag', etagFor(row.version))
          .json({ data: activity.engagements, nextCursor: null });
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`${ENGAGEMENTS}/:id`, requires('record:read'), (req, res, next) => {
    void (async () => {
      try {
        const { row, activity } = await readActivity(db, String(req.params['ref']));
        res
          .set('ETag', etagFor(row.version))
          .json(engagementOf(row, activity, String(req.params['id'])));
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
