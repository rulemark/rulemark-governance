import {
  API_VERSION,
  DataMapQuery,
  ImpactQuery,
  ReportQuery,
  SubprocessorsQuery,
} from '@rulemark/ropa-schemas';
import { Router, type Request } from 'express';

import type { Database } from '../../db/client.js';
import type { Transaction } from '../../domain/transaction.js';
import { partyAggregate } from '../../domain/aggregates.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { fieldErrorsFromZod, notFound } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';
import { buildCoverage } from '../views/coverage.js';
import { buildDataMap } from '../views/data-map.js';
import { buildImpact } from '../views/impact.js';
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

  router.get(`/${API_VERSION}/parties/:ref/impact`, requires('view:impact'), (req, res, next) => {
    void (async () => {
      try {
        const parsed = ImpactQuery.safeParse(queryOf(req));
        if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
        refuseAsOf(parsed.data.asOf);

        const ref = String(req.params['ref']);
        const now = new Date();
        res.json(
          await consistently(async (tx) => {
            // The party is the resource in the path, so an unknown one is a
            // 404, not a field error as `?client=` would be.
            const party = await findByIdentifier<Parameters<typeof partyAggregate.toRef>[0]>(
              tx,
              partyAggregate,
              ref,
            );
            if (party === undefined) throw notFound(`No party matching "${ref}"`);
            return buildImpact(
              tx,
              partyAggregate.toRef(party),
              { expandClients: parsed.data.expandClients ?? false },
              now,
            );
          }),
        );
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`/${API_VERSION}/data-map`, requires('view:datamap'), (req, res, next) => {
    void (async () => {
      try {
        const parsed = DataMapQuery.safeParse(queryOf(req));
        if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
        refuseAsOf(parsed.data.asOf);

        const now = new Date();
        res.json(await consistently((tx) => buildDataMap(tx, parsed.data, now)));
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(`/${API_VERSION}/coverage`, requires('view:coverage'), (req, res, next) => {
    void (async () => {
      try {
        // Coverage is a question about today (step 3, open question 2), so a
        // date is refused rather than quietly ignored.
        if (queryOf(req)['asOf'] !== undefined) {
          refused([
            {
              path: '/asOf',
              code: 'not_supported',
              message: 'Coverage reports on the record as it is today',
            },
          ]);
        }
        const now = new Date();
        res.json(await consistently((tx) => buildCoverage(tx, now)));
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
