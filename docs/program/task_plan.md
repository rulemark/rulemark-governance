# Task Plan: Interface Step 1 — The Workspace Skeleton

## Goal
Stand up the frontend and its component toolkit inside the existing
workspace: `apps/ropa-web` (Next.js) and a component library of its own,
`packages/ui` (shadcn/ui), wired to the RoPA API through the proxy the design
already calls for (`ropa-packages.md` §8.1), with tests and CI from the first
commit. No product screens yet beyond one page that proves the path from the
browser to the record works; what the interface shows comes in the steps
after this one.

The first step of the interface, the roadmap's next priority
(`docs/program/roadmap.md`, "Next: the interface, and what clients see").

## Current Phase
Phase 1 (the component package), not started: all six open questions settled

## The stack (decided by the user, 2026-09-27)
| Concern | Choice |
|---|---|
| Framework | **Next.js** (App Router), **TypeScript** |
| Server state | **TanStack Query** |
| Styling | **Tailwind CSS** (v4) |
| Components | **shadcn/ui**, in a package of its own (`packages/ui`), so the toolkit grows as the user's own |
| Unit and component tests | **Vitest** |
| End-to-end tests | **Playwright** |

Current versions (checked 2026-09-27): Next.js 16.3, React 19.3, TanStack
Query 5.104, Tailwind 4.3, shadcn CLI 4.21, Playwright 1.63, Vitest 5 (the
repo's). TypeScript stays at the repo's 5.9 (see findings).

## Where this step sits (proposed interface build order, to confirm)
1. **The workspace skeleton** (this step): the app, the component package,
   the proxy, one page, tests and CI.
2. **Access:** sign-in through **Stytch** (the user has a workspace), with
   users, roles and permissions kept in the database rather than the
   `PRINCIPALS` environment variable (the data model's F5), and reads that
   are no longer public by default (story III.1, II.1, II.3).
3. **The record, read:** activities, parties, agreements, review items, and
   the views (report, subprocessors, impact, data map, coverage).
4. **The record, written:** forms on the shared schemas (`canActivate` and
   the rest), `If-Match` and conflicts, the review-item inbox.
5. **What clients see:** the public subprocessor page and the exports
   reviewers accept (III.2, III.5), then per-client access (III.18).
6. **Notices and responses**, once the model has them (III.10–III.17).

Separately, on the API: linking engagements to systems (story II.20), which
the user wants soon.

## Definition of done for step 1
- `npm run dev` starts the API and the web app together; the web app's home
  page lists P1–P3 from the local, seeded API, fetched through
  `/api/ropa/*`, with no CORS and no token in the browser.
- `packages/ui` is a shadcn-initialised package with the Tailwind v4 theme,
  imported by the app as `@rulemark/ui`; `npx shadcn add <component>` run
  from the app puts base components in the package.
- `npm run check` type-checks, lints, formats and runs every Vitest suite,
  the new ones included; Playwright runs a smoke test against the app and a
  seeded API, locally and in CI.
- The docs describe it: `workspace-skeleton.md`, `ropa-packages.md` §8, the
  README's getting-started.
- Deployed as `ropa-web` on Render and verified: the live home page lists P1–P3 read through the proxy over the private network (open question 6).

## Phases

### Phase 1: The component package
- [ ] `packages/ui` (`@rulemark/ui`): Tailwind v4, `shadcn init`, its own
      `components.json`, `src/styles/globals.css` with the theme, `lib/utils`
      (`cn`), a first component (`button`)
- [ ] Wired into the workspace's TypeScript, ESLint and Prettier config
- [ ] Vitest in browser mode for components (Chromium, Playwright provider), per open question 5
- **Status:** pending

### Phase 2: The app
- [ ] `apps/ropa-web` on Next.js 16, App Router, its own `components.json`
      pointing at `@rulemark/ui` with the same style, icon library and base
      colour; Tailwind reading the package's `globals.css`
- [ ] TanStack Query provider, a layout shell, a health route
- [ ] The environment validated at startup with Zod, failing fast, as the
      other apps do (`ROPA_API_URL`)
- **Status:** pending

### Phase 3: The proxy and the first page
- [ ] `/api/ropa/[...path]` as a Route Handler forwarding to `ROPA_API_URL`,
      passing `If-Match`, `ETag` and problem responses through untouched
      (`ropa-packages.md` §8.1); reads forwarded anonymously, writes refused
      with a problem naming step 2 (open question 4)
- [ ] `@rulemark/ropa-client`'s core (open question 3): an injectable base
      URL, `fetch` and token provider; responses parsed with the shared
      schemas; `problem+json` as typed errors (`ropa-packages.md` §5.3); `ETag`
      as `version`, `If-Match` required on writes; the activity list call.
      Tested on its own, against a stub server
- [ ] Two instances in the app: the server's (internal host, token) and the
      browser's (`/api/ropa`, no token); the page's query keys and query
      functions shared by the server prefetch and the client (open question 2)
- [ ] The home page lists the activities, with loading and error states
- **Status:** pending

### Phase 4: Tests and CI
- [ ] Vitest in both workspaces, in `npm run check`
- [ ] Playwright: one smoke test (the home page shows P1–P3 read through the
      proxy; a write is refused) against the API with the story replayed;
      locally through `webServer` (API and built web app on the test
      database), in CI as a job with the Postgres service container (migrate,
      seed, start both, Chromium only)
- [ ] Root scripts: `dev` runs both apps; `test:e2e`
- **Status:** pending

### Phase 5: Deploy and docs
- [ ] `ropa-web` in `render.yaml`: a web service (about $7 a month, accepted),
      its own build filter, `ROPA_API_URL` from `ropa-api`'s `hostport`;
      pushed code-first **once the user gives the go-ahead**, verified by
      behaviour (the live page lists P1–P3)
- [ ] `workspace-skeleton.md`, `ropa-packages.md` §8, the README
- **Status:** pending

## Open questions
1. ~~**The component package.**~~ **Resolved (2026-09-27):** `@rulemark/ui`, source-only (Next's `transpilePackages`); Base UI primitives; the Nova style; the neutral base colour, with dark mode from the start (next-themes); Lucide icons. See `findings.md`. Was: Its name (`@rulemark/ui`, where shadcn's docs
   use `@workspace/ui`), and whether it stays source-only, consumed through
   Next's `transpilePackages` like the repo's `development` condition, or is
   built. Plus the shadcn choices both `components.json` files must share:
   style, base colour, icon library, and dark mode from the start or not.
   *Phase 1.*
2. ~~**Where data is fetched.**~~ **Resolved (2026-09-27):** server prefetch and hydration: Server Components prefetch a page's queries straight from the API over the private network, dehydrate them into a `HydrationBoundary`, and client components `useQuery` the same keys through `/api/ropa`; writes are `useMutation` through the proxy, then invalidate. See `findings.md`. Was: Everything through TanStack Query in client
   components via the proxy; or Server Components reading the API directly on
   the server and prefetching into TanStack Query (hydration) so the first
   paint has data, with client components owning interaction and writes. It
   sets the pattern every later screen follows. *Phase 3.*
3. ~~**`@rulemark/ropa-client`.**~~ **Resolved (2026-09-27):** build it now, its core and only the calls the first page uses; each later screen adds its own. §5.1 loses the `actor` option. See `findings.md`. Was: Designed (`ropa-packages.md` §5) and empty
   until its first consumer: this app. Build the client now, shaped by the
   first page (typed errors, `If-Match`, schema validation, two instances for
   browser and server); or let the app call `fetch` with the shared schemas
   and grow the client once screens show what it needs. §5.1's `actor` option
   is out of date either way: the actor comes from the token. *Phase 3.*
4. ~~**Auth in the skeleton.**~~ **Resolved (2026-09-27):** anonymous reads through the proxy and the server prefetch; writes refused with a problem naming step 2. Step 2 brings sign-in through **Stytch**, with users, roles and permissions in the database instead of `PRINCIPALS`. See `findings.md`. Was: Access is step 2's whole subject, but the proxy
   exists now. Proxy anonymous reads only, and refuse writes, until step 2;
   or give the skeleton a development sign-in (mint a token server-side from
   `TOKEN_MINT_SECRET` for a chosen principal) so writes can be tried early.
   *Phase 3.*
5. ~~**Testing layout.**~~ **Resolved (2026-09-27):** Vitest's browser mode (Chromium, Playwright as provider) for components in `packages/ui` and the app's client components, Node for the client package and pure logic; one Playwright smoke test (P1–P3 through the proxy, a write refused) against a seeded API, locally through Playwright's `webServer` and in CI with the Postgres service container. See `findings.md`. Was: Component tests in Vitest with jsdom or happy-dom, or
   Vitest's browser mode (real browser, Playwright as its provider); what
   Playwright tests end to end in this step, and how CI provides it a seeded
   API. *Phases 1 and 4.*
6. ~~**Deploy in this step?**~~ **Resolved (2026-09-27):** yes: `ropa-web` joins the Blueprint as a web service (about $7 a month, accepted), deployed and verified in Phase 5. See `findings.md`. Was: A `ropa-web` web service on Render proves the
   proxy over the private network early, and costs about $7 a month (a
   starter instance). Or stay local until step 2, when there's sign-in and
   something worth showing. *Phase 5.*

## Decisions carried forward
| Decision | Where it came from |
|---|---|
| Rulemark Governance isn't for sale; features are judged by their value to the people using it | Roadmap, 2026-09-27 |
| Self-hosted and single-tenant: one deployment per organisation | Roadmap, Distribution |
| The browser calls only the web app's origin; a Next Route Handler proxies to the API over the private network and holds the token; no CORS | `ropa-packages.md` §8.1 |
| Test-driven throughout; tests are written before the code they cover, and checked by breaking the code on purpose | RoPA steps 1–5 |
| Packages stay source-only, with a `development` export condition; rebuild before `tsc` reads them without it | RoPA step 1 |
| npm workspaces, one ESLint flat config and one Prettier config at the root; no task runner until CI gets slow | `workspace-skeleton.md` §3.3 |
| Code is pushed separately from docs, code first; **nothing is pushed without the user's go-ahead** | RoPA steps; 2026-09-27 |
| **The component package (open question 1):** `packages/ui` is `@rulemark/ui`, source-only, compiled by the app through `transpilePackages`; shadcn on **Base UI**, style **Nova**, base colour **neutral**, **Lucide** icons, CSS variables; dark mode from the start with next-themes (`attribute="class"`, system default). Both `components.json` files share style, icon library and base colour | Interface step 1 |
| **Where data is fetched (open question 2):** Server Components prefetch on the server (to `ropa-api` directly, with the token) and hydrate TanStack Query; client components read the same query keys, refetching through `/api/ropa`; writes are mutations through the proxy that invalidate. One set of query keys and query functions for both sides | Interface step 1 |
| **The API client (open question 3):** `@rulemark/ropa-client` is built now, its core plus the calls the first page uses, and grows with each screen; `ropa-packages.md` §5.1's `actor` option goes (the token decides) | Interface step 1 |
| **Auth in the skeleton (open question 4):** reads go through anonymously, writes are refused until step 2. **Step 2: Stytch** for sign-in, and users, roles and permissions in the database, replacing `PRINCIPALS` | Interface step 1 |
| **Testing layout (open question 5):** Vitest browser mode (Chromium) for components, Node for the client and logic; Playwright smoke-tests the real web app against the real API with the story replayed, locally and in CI; later steps add their own journeys | Interface step 1 |
| **Deploy in step 1 (open question 6):** `ropa-web` joins the Blueprint as a web service; about $7 a month, accepted 2026-09-27 | Interface step 1 |

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
