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
Planning: the open questions below are to be settled one at a time before any
code.

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
2. **Access:** real sign-in for Hireloop's staff, users out of the
   environment variable, and reads that are no longer public by default
   (story III.1, II.1, II.3).
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
- If open question 6 says so: deployed as `ropa-web` on Render, verified.

## Phases

### Phase 1: The component package
- [ ] `packages/ui` (`@rulemark/ui`): Tailwind v4, `shadcn init`, its own
      `components.json`, `src/styles/globals.css` with the theme, `lib/utils`
      (`cn`), a first component (`button`)
- [ ] Wired into the workspace's TypeScript, ESLint and Prettier config
- [ ] Vitest for components (open question 5)
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
      (`ropa-packages.md` §8.1); auth as open question 4 decides
- [ ] The data path open question 2 decides, and the client open question 3
      decides
- [ ] The home page lists the activities, with loading and error states
- **Status:** pending

### Phase 4: Tests and CI
- [ ] Vitest in both workspaces, in `npm run check`
- [ ] Playwright: a smoke test (the home page shows P1–P3) against a seeded
      API; in CI with the existing Postgres service container
- [ ] Root scripts: `dev` runs both apps; `test:e2e`
- **Status:** pending

### Phase 5: Deploy and docs
- [ ] If deploying: `ropa-web` in `render.yaml` (its own build filter,
      `ROPA_API_URL` from `ropa-api`'s `hostport`), pushed code-first,
      verified
- [ ] `workspace-skeleton.md`, `ropa-packages.md` §8, the README
- **Status:** pending

## Open questions
1. **The component package.** Its name (`@rulemark/ui`, where shadcn's docs
   use `@workspace/ui`), and whether it stays source-only, consumed through
   Next's `transpilePackages` like the repo's `development` condition, or is
   built. Plus the shadcn choices both `components.json` files must share:
   style, base colour, icon library, and dark mode from the start or not.
   *Phase 1.*
2. **Where data is fetched.** Everything through TanStack Query in client
   components via the proxy; or Server Components reading the API directly on
   the server and prefetching into TanStack Query (hydration) so the first
   paint has data, with client components owning interaction and writes. It
   sets the pattern every later screen follows. *Phase 3.*
3. **`@rulemark/ropa-client`.** Designed (`ropa-packages.md` §5) and empty
   until its first consumer: this app. Build the client now, shaped by the
   first page (typed errors, `If-Match`, schema validation, two instances for
   browser and server); or let the app call `fetch` with the shared schemas
   and grow the client once screens show what it needs. §5.1's `actor` option
   is out of date either way: the actor comes from the token. *Phase 3.*
4. **Auth in the skeleton.** Access is step 2's whole subject, but the proxy
   exists now. Proxy anonymous reads only, and refuse writes, until step 2;
   or give the skeleton a development sign-in (mint a token server-side from
   `TOKEN_MINT_SECRET` for a chosen principal) so writes can be tried early.
   *Phase 3.*
5. **Testing layout.** Component tests in Vitest with jsdom or happy-dom, or
   Vitest's browser mode (real browser, Playwright as its provider); what
   Playwright tests end to end in this step, and how CI provides it a seeded
   API. *Phases 1 and 4.*
6. **Deploy in this step?** A `ropa-web` web service on Render proves the
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

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
