import { Router } from 'express';

/**
 * Render's health check (`ropa-api.md` §1.1). Unauthenticated, outside `/v1`,
 * and deliberately shallow: it answers "is this process serving?", not "is the
 * database reachable?", because a failing check takes the instance out of
 * rotation and a brief database blip should not.
 */
export const healthzRouter: Router = Router();

healthzRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});
