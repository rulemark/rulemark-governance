import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { buildOpenApiDocument } from '../openapi/document.js';

/**
 * `GET /openapi.json` and `GET /api-docs` (`ropa-api.md` §1.1). Neither needs a
 * token: documentation a caller has to authenticate for is documentation
 * nobody reads.
 */
export function docsRouter(): Router {
  const router = Router();

  // Built once: it is derived from module-level definitions and cannot change
  // while the process runs.
  const document = buildOpenApiDocument();

  router.get('/openapi.json', (_req, res) => {
    res.type('application/json').send(JSON.stringify(document, null, 2));
  });

  router.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'RoPA API',
      swaggerOptions: {
        // Keep the token across a reload, so the demo tour survives an F5.
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
      },
    }),
  );

  return router;
}
