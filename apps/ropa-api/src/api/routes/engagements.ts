import {
  API_VERSION,
  RemoveEngagementInput,
  type Activity,
  type Engagement,
} from '@rulemark/ropa-schemas';
import { Router } from 'express';

import type { Database } from '../../db/client.js';
import { changeEngagement, type EngagementChange } from '../../domain/activity/engagements.js';
import {
  activityAggregate,
  loadActivitySnapshot,
  type ActivityRow,
} from '../../domain/activity/load.js';
import { toActivityOutputs } from '../../domain/activity/output.js';
import type { SaveContext } from '../../domain/aggregate.js';
import { etagFor, requireIfMatch } from '../../domain/concurrency.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { fieldErrorsFromZod, notFound, validationFailed } from '../../shared/problems.js';
import { actorFor } from '../middleware/authenticate.js';
import { requires } from '../middleware/authorize.js';

/**
 * The engagement sub-resource (`ropa-api.md` §3.5): one vendor on an activity,
 * without the whole activity. Engagements are the activity's own rows, not a
 * record of their own (DM §4), so they are read as the activity holds them:
 * the same shape as `GET /activities/{ref}`, the activity's version as the
 * ETag, and the activity's permission. They have no code or slug, so `{id}`
 * is an id only (DM §3.0).
 *
 * Writing one is changing the activity: `record:write`, the activity's version
 * in `If-Match` on every write, `POST` included, and the change note in the
 * body, a `DELETE`'s included (step 5, open questions 3–4). Each write answers
 * with the engagement and the activity's new version.
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

/**
 * Finds the activity, makes the change in one transaction, and reads back the
 * engagement it names.
 */
async function writeEngagement(
  db: Database,
  ref: string,
  expectedVersion: number,
  change: EngagementChange,
  save: SaveContext,
): Promise<{ row: ActivityRow; engagement: Engagement | null }> {
  return db.transaction(async (tx) => {
    const found = await findByIdentifier<ActivityRow>(tx, activityAggregate, ref);
    if (found === undefined) throw notFound(`No activity matching "${ref}"`);
    const { row, engagementId } = await changeEngagement(tx, found, expectedVersion, change, save);
    if (engagementId === null) return { row, engagement: null };
    const [activity] = await toActivityOutputs(tx, [await loadActivitySnapshot(tx, row)]);
    return { row, engagement: engagementOf(row, activity!, engagementId) };
  });
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

  router.post(ENGAGEMENTS, requires('record:write'), (req, res, next) => {
    void (async () => {
      try {
        const expectedVersion = requireIfMatch(req.get('if-match'));
        const { row, engagement } = await writeEngagement(
          db,
          String(req.params['ref']),
          expectedVersion,
          { kind: 'add', body: req.body },
          { actor: actorFor(req) },
        );
        res
          .status(201)
          .set('ETag', etagFor(row.version))
          .set('Location', `/${API_VERSION}/activities/${row.code}/engagements/${engagement!.id}`)
          .json(engagement);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.put(`${ENGAGEMENTS}/:id`, requires('record:write'), (req, res, next) => {
    void (async () => {
      try {
        const expectedVersion = requireIfMatch(req.get('if-match'));
        const { row, engagement } = await writeEngagement(
          db,
          String(req.params['ref']),
          expectedVersion,
          { kind: 'replace', id: String(req.params['id']), body: req.body },
          { actor: actorFor(req) },
        );
        res.set('ETag', etagFor(row.version)).json(engagement);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.delete(`${ENGAGEMENTS}/:id`, requires('record:write'), (req, res, next) => {
    void (async () => {
      try {
        const expectedVersion = requireIfMatch(req.get('if-match'));
        // The body is optional: a removal may carry nothing at all.
        const parsed = RemoveEngagementInput.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw validationFailed('This request is not valid', fieldErrorsFromZod(parsed.error));
        }
        const { row } = await writeEngagement(
          db,
          String(req.params['ref']),
          expectedVersion,
          { kind: 'remove', id: String(req.params['id']) },
          { actor: actorFor(req), changeNote: parsed.data.changeNote },
        );
        res.status(204).set('ETag', etagFor(row.version)).end();
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
