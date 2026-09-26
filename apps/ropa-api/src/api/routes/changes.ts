import { API_VERSION, ChangesQuery } from '@rulemark/ropa-schemas';
import { Router } from 'express';

import type { Database } from '../../db/client.js';
import { listChanges, resolveRange } from '../../domain/changes.js';
import { fieldErrorsFromZod, validationFailed } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';

/**
 * `GET /changes` (`ropa-api.md` §2): what changed across the record in a time
 * range, review items included. Read in one repeatable-read transaction, so a
 * page is one moment's history even while someone saves.
 */
export function changesRouter(db: Database): Router {
  const router = Router();

  router.get(`/${API_VERSION}/changes`, requires('history:read'), (req, res, next) => {
    void (async () => {
      try {
        const raw = Object.fromEntries(
          Object.entries(req.query).flatMap(([key, value]) =>
            typeof value === 'string' && value !== '' ? [[key, value]] : [],
          ),
        );
        const parsed = ChangesQuery.safeParse(raw);
        if (!parsed.success) {
          throw validationFailed('This question cannot be asked', fieldErrorsFromZod(parsed.error));
        }
        const { from, to, entityType, limit, cursor } = parsed.data;
        const range = resolveRange(from, to);

        res.json(
          await db.transaction((tx) => listChanges(tx, { range, entityType, limit, cursor }), {
            isolationLevel: 'repeatable read',
            accessMode: 'read only',
          }),
        );
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
