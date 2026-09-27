import {
  API_VERSION,
  CoverageResponse,
  MAX_PAGE_SIZE,
  type ReviewItem,
  type ReviewStatus,
} from '@rulemark/ropa-schemas';

import type { Logger } from '../shared/logger.js';

/**
 * The coverage cron job (`ropa-api.md` §5.5; step 4, open question 6): the
 * one way a finding reaches a person without anyone asking, and the only
 * thing that will ever act on `review_overdue`, since nothing else notices
 * time passing.
 *
 * It **opens, never decides.** Each finding whose `key` has no open or
 * dismissed item gets one, with the key in `details`. An open item means a
 * person already has it; a dismissal is a person's decision, and stands. A
 * resolved item doesn't block: a finding that comes back means the fix
 * didn't hold. It never resolves or dismisses anything, and its role can't:
 * the person who fixed a finding says why.
 *
 * It calls the API like any other client, over Render's private network, as
 * its own principal (`svc:schedule`, role `service:schedule`), with a token
 * minted for the run.
 */

export interface CoverageJobOptions {
  readonly baseUrl: string;
  readonly subject: string;
  readonly tokenMintSecret: string;
  readonly logger: Logger;
}

export interface CoverageJobResult {
  readonly findings: number;
  readonly opened: { readonly key: string; readonly code: string }[];
  readonly skipped: {
    readonly key: string;
    readonly code: string;
    readonly status: ReviewStatus;
  }[];
  readonly failed: { readonly key: string; readonly error: string }[];
}

/** A status that means the finding is already with a person, or decided. */
const BLOCKING: readonly ReviewStatus[] = ['open', 'dismissed'];

async function problem(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    errors?: { path: string; message: string }[];
  };
  const fields = (body.errors ?? []).map((error) => `${error.path} ${error.message}`).join('; ');
  return [String(response.status), body.detail, fields].filter(Boolean).join(' — ');
}

async function mint(options: CoverageJobOptions): Promise<string> {
  const response = await fetch(`${options.baseUrl}/${API_VERSION}/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: options.subject, secret: options.tokenMintSecret }),
  });
  if (!response.ok) {
    // Principals are added by hand in the dashboard (Phase 6 question 2), so
    // a missing one is the likeliest cause, and the fix is named here.
    throw new Error(
      `Could not mint a token for "${options.subject}" (${await problem(response)}). ` +
        `If "${options.subject}" isn’t in PRINCIPALS, add it to ropa-api's PRINCIPALS ` +
        `with the service:schedule role; otherwise check TOKEN_MINT_SECRET.`,
    );
  }
  return ((await response.json()) as { token: string }).token;
}

export async function runCoverageJob(options: CoverageJobOptions): Promise<CoverageJobResult> {
  const token = await mint(options);
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${options.baseUrl}/${API_VERSION}/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });

  const coverage = await call('coverage');
  if (!coverage.ok) throw new Error(`Could not read coverage (${await problem(coverage)})`);
  const { findings } = CoverageResponse.parse(await coverage.json());

  const result: CoverageJobResult = {
    findings: findings.length,
    opened: [],
    skipped: [],
    failed: [],
  };

  // One at a time: findings are few, and a run's log reads in order.
  for (const finding of findings) {
    const { key } = finding;
    try {
      const existing = await call(
        `review-items?key=${encodeURIComponent(key)}&limit=${MAX_PAGE_SIZE}`,
      );
      if (!existing.ok) throw new Error(`reading items: ${await problem(existing)}`);
      const items = ((await existing.json()) as { data: ReviewItem[] }).data;
      const blocking = items.find((item) => BLOCKING.includes(item.status));
      if (blocking) {
        result.skipped.push({ key, code: blocking.code, status: blocking.status });
        options.logger.info(
          { key, code: blocking.code, status: blocking.status },
          'finding already carried',
        );
        continue;
      }

      const opened = await call('review-items', {
        method: 'POST',
        body: JSON.stringify({
          targetType: finding.targetType,
          target: finding.target.id,
          source: 'schedule',
          reason: finding.type,
          // No dueAt: choosing a deadline would be deciding.
          details: { key, severity: finding.severity, ...finding.details },
        }),
      });
      if (!opened.ok) throw new Error(`opening an item: ${await problem(opened)}`);
      const { code } = (await opened.json()) as ReviewItem;
      result.opened.push({ key, code });
      options.logger.info(
        { key, code, type: finding.type, target: finding.target },
        'review item opened',
      );
    } catch (error) {
      // One finding's failure is logged and reported; the rest still run.
      const message = (error as Error).message;
      result.failed.push({ key, error: message });
      options.logger.error({ key, error: message }, 'could not carry a finding');
    }
  }

  return result;
}
