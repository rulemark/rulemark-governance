import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A request the stub server received. */
export interface Received {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

/** What the stub answers: a status, headers and a body (JSON unless a string). */
export interface Answer {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * A real HTTP server on 127.0.0.1 standing in for ropa-api, so the client is
 * tested through `fetch` as it runs, not through a mock of it.
 */
export async function stubApi(answer: (request: Received) => Answer = () => ({})) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers };
    received.push(request);
    const { status = 200, headers = {}, body = {} } = answer(request);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(text);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const UUID = '0199c3a1-8f2e-7c4d-b8e1-2f3a4b5c6d7e';
const ref = (slug: string, name: string) => ({ id: UUID, slug, name });

/** P3 as the API returns it: a processor activity that passes `Activity`. */
export const P3 = {
  id: UUID,
  version: 2,
  createdAt: '2026-02-10T09:12:00Z',
  updatedAt: '2026-06-20T14:03:00Z',
  code: 'P3',
  name: 'CV parsing',
  role: 'processor',
  status: 'active',
  description: null,
  owner: 'Priya Raman',
  roleRationale: null,
  supersedes: null,
  subjectCategories: [ref('candidates', 'Candidates')],
  dataCategories: [ref('identity', 'Identity & contact')],
  systems: [ref('hireloop-app', 'Recruiter app')],
  securityMeasures: [],
  reviewDueAt: '2027-02-10',
  startedAt: '2026-02-10',
  endedAt: null,
  offering: ref('ats', 'Applicant tracking'),
  clientCoverage: 'all_enrolled',
  processingCategories: ['hosting'],
  clientScope: null,
  dpiaSupportRef: null,
  engagements: [],
};

/** A problem as the API writes one (RFC 9457). */
export function problem(status: number, type: string, title: string, extra: object = {}): Answer {
  return {
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: { type: `https://ropa.example/problems/${type}`, title, status, ...extra },
  };
}
