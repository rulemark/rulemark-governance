import {
  Activity,
  listResponse,
  type ActivityRole,
  type ActivityStatus,
} from '@rulemark/ropa-schemas';
import type { z } from 'zod';

import { RopaResponseError, errorFrom } from './errors.ts';

/** Where the token comes from: a string, or a provider asked on every call. */
export type TokenSource = string | (() => string | undefined | Promise<string | undefined>);

export interface RopaClientOptions {
  /**
   * The API's base URL. In the browser a relative one works (`/api/ropa`, the
   * web app's proxy); in Node it must be absolute (ropa-packages.md §8.1).
   */
  baseUrl: string;
  /** Sent as `Authorization: Bearer` (API §1.9). The browser's instance has none. */
  token?: TokenSource;
  /** Parse responses with the shared schemas (default); `false` skips it. */
  validate?: boolean;
  /** Injectable, for tests and server rendering; the global `fetch` otherwise. */
  fetch?: typeof fetch;
}

/** Per call. */
export interface CallOptions {
  signal?: AbortSignal;
}

/** One page of a list (API §1.4): its items, and the cursor to the next, or null. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Paging for any list. */
export interface ListQuery {
  limit?: number;
  cursor?: string;
}

/** `GET /v1/activities`: the API's filters, each optional. */
export interface ActivityListQuery extends ListQuery {
  role?: ActivityRole;
  status?: ActivityStatus;
  offering?: string;
  subjectCategory?: string;
  dataCategory?: string;
  party?: string;
  system?: string;
  country?: string;
  special?: true;
}

const ActivityPage = listResponse(Activity);

export interface RopaClient {
  activities: {
    /** One page of activities, in the order they were created. */
    list(query?: ActivityListQuery, options?: CallOptions): Promise<Page<Activity>>;
  };
}

/**
 * The RoPA API, typed (ropa-packages.md §5). Built up call by call as the
 * interface needs them: each screen adds the calls it uses.
 */
export function createRopaClient(options: RopaClientOptions): RopaClient {
  const base = options.baseUrl.replace(/\/+$/, '');
  const validate = options.validate ?? true;
  // Looked up on each call, not captured, so a test or a runtime can replace it.
  const send: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function authorization(): Promise<Record<string, string>> {
    const token = typeof options.token === 'function' ? await options.token() : options.token;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function get<T extends z.ZodType>(
    schema: T,
    path: string,
    query: object,
    { signal }: CallOptions,
  ): Promise<z.output<T>> {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined) params.set(name, String(value));
    }
    const search = params.size > 0 ? `?${params}` : '';

    const response = await send(`${base}${path}${search}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...(await authorization()) },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw await errorFrom(response);

    const body: unknown = await response.json();
    if (!validate) return body as z.output<T>;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new RopaResponseError(parsed.error.issues, response);
    return parsed.data;
  }

  return {
    activities: {
      list: (query = {}, callOptions = {}) =>
        get(ActivityPage, '/v1/activities', query, callOptions),
    },
  };
}
