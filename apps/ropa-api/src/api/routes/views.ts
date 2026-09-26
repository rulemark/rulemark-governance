import {
  API_VERSION,
  DataMapQuery,
  ImpactQuery,
  ReportQuery,
  SubprocessorsQuery,
} from '@rulemark/ropa-schemas';
import { Router, type Request } from 'express';

import type { Database } from '../../db/client.js';
import { recordAsOf, resolveAsOf } from '../../domain/record/as-of.js';
import { liveRecord } from '../../domain/record/live.js';
import { refOf } from '../../domain/record/reader.js';
import { fieldErrorsFromZod, notFound } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';
import { buildCoverage } from '../views/coverage.js';
import { buildDataMap } from '../views/data-map.js';
import { buildImpact } from '../views/impact.js';
import { renderReportMarkdown } from '../views/markdown.js';
import { buildReport } from '../views/report.js';
import { noMatch, refused, resolveViewScope, type ViewRead } from '../views/scope.js';
import { buildSubprocessors } from '../views/subprocessors.js';

/**
 * The views (`ropa-api.md` §5): read models derived from the record, today's
 * or, with `?asOf=`, as it stood then (DB §6.3). Each answer is read inside
 * one repeatable-read, read-only transaction, so the agreements, activities
 * and names it combines come from the same moment, even while someone saves.
 */

/** Query parameters arrive as strings, or as arrays when repeated. */
function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' && value !== '' ? [[key, value]] : [],
    ),
  );
}

export function viewsRouter(db: Database): Router {
  const router = Router();

  /**
   * Reads the record live, or as of `asOf` when one was asked for. A future
   * `asOf` is refused before any reading starts.
   */
  const reading = <T>(asOf: string | undefined, work: (read: ViewRead) => Promise<T>) => {
    const now = new Date();
    const point = asOf === undefined ? null : resolveAsOf(asOf, now);
    return db.transaction(
      async (tx) =>
        work({
          record: point === null ? liveRecord(tx, now) : await recordAsOf(tx, point),
          generatedAt: now,
          asOf: point?.asked ?? null,
        }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  };

  router.get(`/${API_VERSION}/subprocessors`, requires('view:subprocessors'), (req, res, next) => {
    void (async () => {
      try {
        const parsed = SubprocessorsQuery.safeParse(queryOf(req));
        if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
        res.json(
          await reading(parsed.data.asOf, async (read) =>
            buildSubprocessors(read, await resolveViewScope(read, parsed.data)),
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
        if (query.format === 'csv') {
          refused([
            {
              path: '/format',
              code: 'not_yet_supported',
              message: 'CSV arrives in a later build step; use json or markdown',
            },
          ]);
        }

        const report = await reading(query.asOf, (read) => buildReport(read, query));
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
        const ref = String(req.params['ref']);
        res.json(
          await reading(parsed.data.asOf, async (read) => {
            // The party is the resource in the path, so an unknown one is a
            // 404, not a field error as `?client=` would be. So is one that
            // did not exist yet on the day asked about.
            const party = await read.record.find('party', ref);
            if (party === undefined) throw notFound(noMatch(read, 'party', ref));
            return buildImpact(read, refOf('party', party), {
              expandClients: parsed.data.expandClients ?? false,
            });
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
        res.json(await reading(parsed.data.asOf, (read) => buildDataMap(read, parsed.data)));
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
        res.json(await reading(undefined, buildCoverage));
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
