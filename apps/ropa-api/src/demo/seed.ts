import { loadDemoClientConfigOrExit } from '../shared/startup.js';
import { loadDemoData, mintToken, type Outcome } from './load-over-http.js';

/**
 * `npm run demo:data`: loads the Hireloop story **through the API**, the way
 * any other client would (`load-over-http.ts`). It needs no database access,
 * so it works against a deployed service or a Render preview environment
 * (`DEMO_API_URL`), which also makes it a real smoke test of a deployment.
 *
 * This is not `db:seed`, which replays the story through the domain layer and
 * backdates it. Everything created here is stamped now.
 */

const config = loadDemoClientConfigOrExit();

function print(outcome: Outcome): void {
  if (outcome.status !== 'failed') return;
  process.stdout.write(`  failed  ${outcome.label}\n          ${outcome.detail ?? ''}\n`);
}

async function main(): Promise<void> {
  process.stdout.write(
    `Loading the Hireloop story into ${config.baseUrl} as "${config.subject}"\n\n`,
  );

  const token = await mintToken(config.baseUrl, config.subject, config.tokenMintSecret);
  const outcomes = await loadDemoData(config.baseUrl, token, print);

  const count = (status: Outcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;
  process.stdout.write(
    `\n  ${count('created')} created, ${count('exists')} already there, ${count('failed')} failed\n`,
  );
  if (count('failed') > 0) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
