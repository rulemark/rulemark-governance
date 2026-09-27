import { createLogger } from '../shared/logger.js';
import { loadCoverageJobConfigOrExit } from '../shared/startup.js';
import { runCoverageJob } from './coverage-job.js';

/**
 * `npm run job:coverage`: the Render cron job's start command (nightly at
 * 02:00 UTC). One run, then exit: non-zero when anything failed, so Render
 * marks the run failed and the dashboard shows it.
 */
const config = loadCoverageJobConfigOrExit();
const logger = createLogger(config);

try {
  const result = await runCoverageJob({ ...config, logger });
  logger.info(
    {
      findings: result.findings,
      opened: result.opened.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
    },
    'coverage job finished',
  );
  if (result.failed.length > 0) process.exitCode = 1;
} catch (error) {
  logger.error({ err: error }, 'coverage job failed');
  process.exitCode = 1;
}
