import {
  API_VERSION,
  SubprocessorsQuery,
  SubprocessorsResponse,
  type ActivityRef,
  type FieldError,
  type Ref,
} from '@rulemark/ropa-schemas';
import { and, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';

import type { Database } from '../../db/client.js';
import { agreementTerms, processingActivity } from '../../db/schema/index.js';
import { loadActivitySnapshots } from '../../domain/activity/load.js';
import { offeringAggregate, partyAggregate } from '../../domain/aggregates.js';
import { activeAgreementsOf, isoDate } from '../../domain/agreements.js';
import { findByIdentifier } from '../../domain/identifiers.js';
import { loadRefs, requireRef } from '../../domain/refs.js';
import type { Transaction } from '../../domain/transaction.js';
import {
  clientSubprocessors,
  standardSubprocessors,
  type SubprocessorGroup,
} from '../../domain/views/subprocessors.js';
import { fieldErrorsFromZod, validationFailed } from '../../shared/problems.js';
import { requires } from '../middleware/authorize.js';

/**
 * The views (`ropa-api.md` §5): read models derived from the record. This
 * step has `/subprocessors`; `/report` follows. The route chooses what to load
 * and names things; what counts is decided by the functions over aggregates in
 * `domain/views`.
 */

function refused(errors: FieldError[]): never {
  throw validationFailed('This view cannot be answered as asked', errors);
}

/** Query parameters arrive as strings, or as arrays when repeated. */
function queryOf(req: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.query).flatMap(([key, value]) =>
      typeof value === 'string' && value !== '' ? [[key, value]] : [],
    ),
  );
}

/** The live processor activities of one offering, as aggregates. */
async function offeringActivities(tx: Transaction, offeringId: string) {
  const rows = await tx
    .select()
    .from(processingActivity)
    .where(
      and(
        eq(processingActivity.offeringId, offeringId),
        eq(processingActivity.role, 'processor'),
        eq(processingActivity.status, 'active'),
      ),
    );
  return loadActivitySnapshots(tx, rows);
}

async function termsRef(tx: Transaction, termsId: string) {
  const [terms] = await tx.select().from(agreementTerms).where(eq(agreementTerms.id, termsId));
  if (terms === undefined) throw new Error(`Dangling reference: terms ${termsId}`);
  return {
    id: terms.id,
    slug: terms.slug,
    name: terms.name,
    authorizationType: terms.authorizationType,
    noticeDays: terms.noticeDays,
  };
}

async function subprocessors(tx: Transaction, req: Request): Promise<SubprocessorsResponse> {
  const parsed = SubprocessorsQuery.safeParse(queryOf(req));
  if (!parsed.success) refused(fieldErrorsFromZod(parsed.error));
  const query = parsed.data;

  // Current state only until history reads arrive; answering for today when
  // a date was asked for would be a quiet wrong answer.
  if (query.asOf !== undefined) {
    refused([
      {
        path: '/asOf',
        code: 'not_yet_supported',
        message: 'asOf arrives with history reads in a later build step',
      },
    ]);
  }

  const now = new Date();
  const day = isoDate(now);
  let offeringId: string;
  let termsId: string;
  let client: { id: string } | undefined;

  if (query.offering !== undefined) {
    const offering = await findByIdentifier<{ id: string; defaultTermsId: string }>(
      tx,
      offeringAggregate,
      query.offering,
    );
    if (offering === undefined) {
      refused([
        {
          path: '/offering',
          code: 'unknown_reference',
          message: `No offering matching "${query.offering}"`,
        },
      ]);
    }
    offeringId = offering.id;
    termsId = offering.defaultTermsId;
  } else {
    const identifier = query.client!;
    client = await findByIdentifier<{ id: string }>(tx, partyAggregate, identifier);
    if (client === undefined) {
      refused([
        {
          path: '/client',
          code: 'unknown_reference',
          message: `No party matching "${identifier}"`,
        },
      ]);
    }
    const agreements = await activeAgreementsOf(tx, client.id, now);
    const offerings = new Set(agreements.map((row) => row.offeringId));
    if (agreements.length === 0) {
      refused([
        {
          path: '/client',
          code: 'no_active_agreement',
          message: 'This client holds no agreement in force, so none of its data is processed',
        },
      ]);
    }
    if (offerings.size > 1) {
      refused([
        {
          path: '/client',
          code: 'several_offerings',
          message:
            'This client holds agreements for several offerings; a per-client list for more than one is not supported yet',
        },
      ]);
    }
    offeringId = agreements[0]!.offeringId;
    termsId = agreements[0]!.termsId;
  }

  const activities = await offeringActivities(tx, offeringId);
  const standard =
    client === undefined ? standardSubprocessors(activities, offeringId, day) : undefined;
  const groups =
    standard?.subprocessors ?? clientSubprocessors(activities, offeringId, client!.id, day);
  const modules = standard?.optionalModules ?? [];

  const allGroups = [...groups, ...modules.flatMap((module) => module.subprocessors)];
  const parties = await loadRefs(tx, partyAggregate, [
    ...allGroups.map((group) => group.partyId),
    ...(client === undefined ? [] : [client.id]),
  ]);
  const offerings = await loadRefs(tx, offeringAggregate, [offeringId]);
  const activityRefs = new Map<string, ActivityRef>(
    activities.map((activity) => [
      activity.id,
      { id: activity.id, code: activity.code, name: activity.name },
    ]),
  );

  const toEntry = (group: SubprocessorGroup) => ({
    party: requireRef(parties, group.partyId, 'subprocessor.party'),
    services: group.services,
    processingCountries: group.processingCountries,
    transfers: group.transfers,
    activities: group.activityIds.map((id) => activityRefs.get(id)!),
  });

  return SubprocessorsResponse.parse({
    generatedAt: now.toISOString(),
    asOf: null,
    scope: {
      offering: requireRef(offerings, offeringId, 'offering'),
      client: client === undefined ? null : (requireRef(parties, client.id, 'client') as Ref),
      terms: await termsRef(tx, termsId),
    },
    subprocessors: groups.map(toEntry),
    optionalModules: modules.map((module) => ({
      activity: activityRefs.get(module.activityId)!,
      subprocessors: module.subprocessors.map(toEntry),
    })),
  });
}

export function viewsRouter(db: Database): Router {
  const router = Router();

  router.get(`/${API_VERSION}/subprocessors`, requires('view:subprocessors'), (req, res, next) => {
    void (async () => {
      try {
        // One consistent picture: agreements, activities and names read at the
        // same moment, even while someone saves.
        const body = await db.transaction((tx) => subprocessors(tx, req), {
          isolationLevel: 'repeatable read',
          accessMode: 'read only',
        });
        res.json(body);
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
