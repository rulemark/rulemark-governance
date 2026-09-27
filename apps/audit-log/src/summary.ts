import type { EventEnvelope } from '@rulemark/ropa-schemas/events';

/**
 * One readable line per event, for watching them arrive in Render's logs.
 * Only the envelope is a contract so far (step 4, Phase 5 question 3), so the
 * data is read loosely, and anything unexpected falls back to type and id.
 */

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** A Ref by its code, else its slug, else its name in quotes. */
function refName(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const code = text(value['code']) ?? text(value['slug']);
  if (code) return code;
  const name = text(value['name']);
  return name ? `"${name}"` : undefined;
}

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

function describe(event: EventEnvelope): string | undefined {
  const data = event.data;
  switch (event.type) {
    case 'record.changed': {
      const entity = refName(data['entity']);
      if (!entity) return undefined;
      return `${text(data['entityType'])} ${entity} v${data['version']} ${text(data['changeType'])} by ${text(data['actor'])}`;
    }
    case 'review_item.changed': {
      const item = isObject(data['reviewItem']) ? text(data['reviewItem']['code']) : undefined;
      if (!item) return undefined;
      return `${item} ${text(data['changeType'])} by ${text(data['actor'])}`;
    }
    case 'subprocessors.changed': {
      const offering = refName(data['offering']);
      if (!offering) return undefined;
      const client = refName(data['client']);
      const changes = `+${count(data['added'])} -${count(data['removed'])} ~${count(data['changed'])}`;
      return `${offering}${client ? ` for ${client}` : ''}: ${changes}`;
    }
  }
}

export function summarize(event: EventEnvelope): string {
  return `${event.type} ${describe(event) ?? event.id}`;
}
