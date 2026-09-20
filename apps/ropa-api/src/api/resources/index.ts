import { API_VERSION } from '@rulemark/ropa-schemas';
import { Router } from 'express';

import type { Database } from '../../db/client.js';
import {
  agreementTermsResource,
  agreementsResource,
  dataCategoriesResource,
  offeringsResource,
  partiesResource,
  securityMeasuresResource,
  subjectCategoriesResource,
  systemsResource,
} from './definitions.js';
import { resourceRouter } from './resource-router.js';

/**
 * The foundation records (`ropa-api.md` §2). Activities, review items and the
 * views are step 2; they mount here the same way.
 */
export function recordsRouter(db: Database): Router {
  const router = Router();

  const resources = [
    partiesResource,
    agreementTermsResource,
    offeringsResource,
    agreementsResource,
    systemsResource,
    subjectCategoriesResource,
    dataCategoriesResource,
    securityMeasuresResource,
  ] as const;

  for (const resource of resources) {
    router.use(`/${API_VERSION}`, resourceRouter(db, resource as never));
  }

  return router;
}
