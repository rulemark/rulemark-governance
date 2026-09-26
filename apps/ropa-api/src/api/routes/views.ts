import { API_VERSION, ReportQuery, SubprocessorsQuery } from '@rulemark/ropa-schemas';
import { Router, type Request } from 'express';

import type { Database } from '../../db/client.js';
import type { Transaction } from '../../domain/transaction.js';
import { fieldErrorsFromZod } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';
import { renderReportMarkdown } from '../views/markdown.js';
import { buildReport } from '../views/report.js';
import { refused, resolveViewScope } from '../views/scope.js';
import { buildSubprocessors } from '../views/subprocessors.js';

/**
 * The views (`ropa-api.md` §5): read models derived from the record. Each
 * answer is read inside one repeatable-read, read-only transaction, so the
 * agreements, activities and names it combines come from the same moment,
 * even while someone saves.
 */

/** Query parameters arrive as strings, or as arrays when repeated. */
function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' && value !== '' ? [[key, value]] : [],
    ),
  );
}

/**
 * Current state only until history reads arrive (build step 4). Answering for
 * today when a date was asked for would be a quiet wrong answer.
 */
function refuseAsOf(asOf: string | undefined): void {
  if (asOf !== undefined) {
    refused([
      {
        path: '/asOf',
        code: 'not_yet_supported',
        message: 'asOf arrives with history reads in a later build step',
      },
    ]);
  }
}

export function viewsRouter(db: Database): Router {
  const router = Router();
  const consistently = <T>(work: (tx: Transaction) => Promise<T>): Promise<T> =>
    db.transaction((tx) => work(tx), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });

  router.get(`/${API_VERSION}/subprocessors`, requires('view:subprocessors'), (req, res, next) => {
    void (async () => {
      try {
        const parsed = SubprocessorsQuery.safeParse(queryOf(req));
        if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
        refuseAsOf(parsed.data.asOf);

        const now = new Date();
        res.json(
          await consistently(async (tx) =>
            buildSubprocessors(tx, await resolveViewScope(tx, parsed.data, now), now),
          ),
        );
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`/${API_VERSION}/report`, requires('view:report'), (req, res, next) => {
    void (async () => {
      try {
        const parsed = ReportQuery.safeParse(queryOf(req));
        if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
        const query = parsed.data;
        refuseAsOf(query.asOf);
        if (query.format === 'csv') {
          refused([
            {
              path: '/format',
              code: 'not_yet_supported',
              message: 'CSV arrives in a later build step; use json or markdown',
            },
          ]);
        }

        const report = await consistently((tx) => buildReport(tx, query, new Date()));
        if (query.format === 'markdown') {
          res.type('text/markdown; charset=utf-8').send(renderReportMarkdown(report));
        } else {
          res.json(report);
        }
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
