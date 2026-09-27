import { ActivityInput, fieldErrorsFromZod, type FieldError } from '@rulemark/ropa-schemas';

import { notFound, Problem, validationFailed } from '../../shared/problems.js';
import { staleVersion, type SaveContext } from '../aggregate.js';
import type { Transaction } from '../transaction.js';
import { inputFromSnapshot } from './input.js';
import { loadActivitySnapshot, type ActivityRow } from './load.js';
import { replaceActivity, type ActivitySaveInput } from './save.js';

/**
 * Writing one engagement (`ropa-api.md` §3.5). It is still one aggregate, so a
 * write is a read-modify-save of the whole activity through its `PUT` path:
 * the stored activity as a body (`inputFromSnapshot`), one engagement added,
 * replaced or removed, and the same save. Versioning, validation of the whole
 * activity (role rules when active), the revision, `record.changed` and
 * `subprocessors.changed` all come with it.
 *
 * Errors come back where the caller can act on them (step 5, Phase 3): those
 * in the engagement written point into the body sent (`/transfers/0`), and
 * anything wrong elsewhere in the activity keeps its path under `/activity`.
 */

type Body = Record<string, unknown>;

export type EngagementChange =
  | { readonly kind: 'add'; readonly body: unknown }
  | { readonly kind: 'replace'; readonly id: string; readonly body: unknown }
  | { readonly kind: 'remove'; readonly id: string };

export interface EngagementSaved {
  readonly row: ActivityRow;
  /** The engagement added or replaced; null after a removal. */
  readonly engagementId: string | null;
}

function refuse(errors: readonly FieldError[]): never {
  throw validationFailed('This engagement is not valid', errors);
}

function engagementBody(body: unknown): Body {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    refuse([{ path: '', code: 'invalid_type', message: 'An engagement is a JSON object' }]);
  }
  return body as Body;
}

/** The body's fields, less the change note, which belongs to the revision. */
function withoutNote({ changeNote: _changeNote, ...engagement }: Body): Body {
  return engagement;
}

/**
 * Activity paths to the caller's: `/engagements/{index}/…` for the engagement
 * written becomes `/…`, and every other path moves under `/activity`. The
 * change note is the body's own either way.
 */
function relocate(errors: readonly FieldError[], index: number | null): FieldError[] {
  const own = index === null ? null : `/engagements/${index}`;
  return errors.map((error) => {
    if (error.path === '/changeNote') return error;
    if (own !== null && (error.path === own || error.path.startsWith(`${own}/`))) {
      return { ...error, path: error.path.slice(own.length) };
    }
    return { ...error, path: `/activity${error.path}` };
  });
}

function indexOf(row: ActivityRow, engagements: readonly Body[], id: string): number {
  const index = engagements.findIndex((engagement) => engagement['id'] === id);
  if (index === -1) throw notFound(`Activity ${row.code} holds no engagement ${id}`);
  return index;
}

export async function changeEngagement(
  tx: Transaction,
  row: ActivityRow,
  expectedVersion: number,
  change: EngagementChange,
  context: SaveContext,
): Promise<EngagementSaved> {
  // The save checks the version again under its lock; checking here first
  // keeps a stale caller from hearing about a state of the activity it never saw.
  if (row.version !== expectedVersion) throw staleVersion('activity', expectedVersion, row.version);

  const stored = await loadActivitySnapshot(tx, row);
  const input = inputFromSnapshot(stored);
  const engagements = [...(input['engagements'] as Body[])];

  let index: number | null;
  let changeNote = context.changeNote;
  if (change.kind === 'remove') {
    engagements.splice(indexOf(row, engagements, change.id), 1);
    index = null;
  } else {
    const body = engagementBody(change.body);
    changeNote = body['changeNote'] as string | undefined;
    if (change.kind === 'add') {
      if (body['id'] !== undefined) {
        refuse([
          {
            path: '/id',
            code: 'not_allowed',
            message: 'A new engagement gets its id from the server',
          },
        ]);
      }
      engagements.push(withoutNote(body));
      index = engagements.length - 1;
    } else {
      index = indexOf(row, engagements, change.id);
      if (body['id'] !== undefined && body['id'] !== change.id) {
        refuse([
          { path: '/id', code: 'id_mismatch', message: `Must be ${change.id}, the id in the path` },
        ]);
      }
      engagements[index] = { ...withoutNote(body), id: change.id };
    }
  }

  const parsed = ActivityInput.safeParse({
    ...input,
    engagements,
    ...(changeNote === undefined ? {} : { changeNote }),
  });
  if (!parsed.success) refuse(relocate(fieldErrorsFromZod(parsed.error), index));
  // The stored activity's own role, so never the joint controller it refuses.
  const saving = parsed.data as ActivitySaveInput;

  let saved: ActivityRow;
  try {
    saved = await replaceActivity(tx, row.id, expectedVersion, saving, {
      ...context,
      changeNote: saving.changeNote,
    });
  } catch (error) {
    if (error instanceof Problem && error.errors !== undefined) {
      throw new Problem({
        status: error.status,
        type: error.type,
        title: error.title,
        detail: error.detail,
        errors: relocate(error.errors, index),
        extensions: error.extensions,
      });
    }
    throw error;
  }

  if (change.kind === 'replace') return { row: saved, engagementId: change.id };
  if (change.kind === 'remove') return { row: saved, engagementId: null };
  const before = new Set(stored.engagements.map((engagement) => engagement.id));
  const after = await loadActivitySnapshot(tx, saved);
  const added = after.engagements.find((engagement) => !before.has(engagement.id));
  if (added === undefined) throw new Error('The saved activity holds no new engagement');
  return { row: saved, engagementId: added.id };
}
