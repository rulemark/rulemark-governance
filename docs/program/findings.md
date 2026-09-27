# Findings & Decisions — Interface Step 1

> The RoPA API's five build steps are archived in `plan-archive/1/` to
> `plan-archive/6/`; their `findings.md` files record what the tools and the
> platform actually did, and several conclusions still hold here.

## Reference documents
- `docs/program/roadmap.md`: the priorities, and every story gap by where it lands
- `docs/ropa/ropa-packages.md`: the client package §5, the deployment topology §8 (the proxy §8.1, the Blueprint sketch for `ropa-web` §8.2)
- `docs/program/workspace-skeleton.md`: the repository's layout and tooling
- `docs/ropa/ropa-story.md`: Parts II and III, which found the gaps the interface is meant to close

## What exists already
- **`apps/ropa-web`** is a placeholder: a `package.json` naming
  `@rulemark/ropa-client` and `@rulemark/ropa-schemas` as dependencies, and a
  README pointing at `ropa-packages.md` §8.1.
- **`@rulemark/ropa-client`** is empty apart from the generated
  `openapi.json`; §5 designs it (namespaces per endpoint, `If-Match` required
  on writes at compile time, typed errors, cursor iteration, validation with
  the shared schemas). Its `actor` option predates auth and is out of date.
- **`@rulemark/ropa-schemas`** exports every input and output schema, and the
  single-record rules (`canActivate` and the rest) a form can run, so a form
  can show the errors the server would return.
- **The ESLint config already ignores `**/.next/**`.**
- **The topology is designed** (`ropa-packages.md` §8.1): the browser calls
  `/api/ropa/*` on the web app's origin; a catch-all Route Handler forwards to
  `ropa-api` over the private network with the token; `If-Match`, `ETag` and
  `Authorization` pass straight through; two client instances, one relative
  for the browser and one with the internal host for the server.

## Versions (npm, 2026-09-27)
| Package | Version | Note |
|---|---|---|
| next | 16.3.6 | peer: React 18.2 or 19; Playwright 1.51+ optional |
| react | 19.3.0 | |
| @tanstack/react-query | 5.104.0 | |
| tailwindcss | 4.3.3 | v4: CSS-first configuration, no `tailwind.config` needed |
| shadcn (CLI) | 4.21.0 | |
| @playwright/test | 1.63.0 | |
| vitest | 5.0.2 | the repo is on 5.0.1 |
| @vitejs/plugin-react | 6.1.1 | for component tests |
| @testing-library/react | 16.3.3 | |
| eslint-config-next | 16.3.6 | |
| typescript | 7.0.2 | **the repo stays on 5.9**: `typescript-eslint` still requires below 6.1 (`workspace-skeleton.md` §3.3) |

## shadcn in a monorepo (ui.shadcn.com/docs/monorepo, 2026-09-27)
- The documented structure is exactly the one wanted: an app, and
  `packages/ui` holding `src/components`, `hooks`, `lib` and
  `styles/globals.css`.
- **Each workspace has its own `components.json`**: the app's aliases point
  at the package (`ui` → `<pkg>/components`, `utils` → `<pkg>/lib/utils`),
  the package's at itself. **Both must share `style`, `iconLibrary` and
  `baseColor`.** With Tailwind v4 the `tailwind.config` entry is left empty,
  and the app's `css` points at the package's `globals.css`.
- **The CLI runs from the app** (`npx shadcn@latest add <component>`): base
  components land in `packages/ui`, blocks in the app, with imports rewritten.
- The docs use pnpm and Turborepo and the scope `@workspace/ui`; nothing in
  them requires either, and npm workspaces work.

## Carried-forward cautions
- **Render judges a push by its newest commit**, and a docs-only commit
  deploys nothing: push code first. **Push nothing without the user's
  go-ahead.**
- **Check push access with git's own SSH command** (the repo's
  `core.sshCommand` key), not a bare `ssh -T`, and retry once before
  suspecting credentials.
- **Confirm a deploy by its behaviour**, not by `/healthz` uptime alone.
- **A test written after the code passes by construction**: break the code on
  purpose. A test that passes before the code exists (a `404` from a missing
  route) must check what it's actually about.
- **A new package export needs a rebuild** before `tsc` reads it without the
  `development` condition.
- **Markdown is excluded from Prettier.**
- **zsh doesn't split unquoted variables into words**, and `$n)` in a pattern
  is read as a subscript: do shell loops in Python, or quote carefully.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->
- **The component package (open question 1, 2026-09-27).** `@rulemark/ui`
  in `packages/ui`, **source-only**: it exports its TypeScript sources and
  the app compiles them through Next's `transpilePackages`, as the repo's
  other packages serve sources through a `development` condition. No build
  step, and an edit to a component shows in the app at once; built output
  can come if the toolkit is ever used outside this repo. **Base UI** as the
  primitives: shadcn's current default (`base-nova`), actively developed, and
  supported by every style (Radix has more third-party examples; React Aria,
  a first-class base since July 2026, the strongest accessibility behaviour).
  **Nova** style: compact without being cramped, for an app of lists and
  forms. **Neutral** base colour (fixed once initialised) with **dark mode
  from the start**, via next-themes as shadcn recommends, because retrofitting
  it once screens exist is the expensive way. **Lucide** icons, the default.
  Rejected: a built package (a build and watch step for no consumer outside
  the repo), light only.
- **The shadcn CLI is ahead of its documentation page** (checked
  2026-09-27). `components.json`'s page lists only the `new-york` style and no
  choice of primitives, but `shadcn init` (4.21) takes `--base base|radix|aria`
  and presets named for base and style (`base-nova`, the default). The styles
  are Vega (classic), Nova, Maia, Lyra and Mira. Trust `--help` and the
  changelog over the reference page.
- **Where data is fetched (open question 2, 2026-09-27).** TanStack Query's
  documented App Router pattern: a page's Server Component prefetches its
  queries on the server, straight to `ropa-api` over the private network with
  the token, dehydrates them into a `HydrationBoundary`, and its client
  components `useQuery` the same keys, refetching through `/api/ropa` in the
  browser. Writes are `useMutation` through the proxy, then invalidate. The
  first paint has data and no loading flash; one query-key scheme serves both
  sides; and the public subprocessor page (step 5) is server-rendered for
  free. The cost, two fetch paths, is the one `ropa-packages.md` §8.1 already
  planned for (two client instances). Rejected: client-only (a loading state
  on every screen, and the public page to revisit), and Server Components with
  Server Actions (TanStack Query reduced to a side tool, the proxy barely
  used).
- **The API client (open question 3, 2026-09-27).** `@rulemark/ropa-client`
  is built now, as `ropa-packages.md` §5 designs it, but only its core and the
  calls the first page needs: an injectable base URL, `fetch` and token
  provider, so the server's instance (internal host, token) and the browser's
  (`/api/ropa`, no token) are the same code; responses parsed with the shared
  schemas; `problem+json` as the typed errors of §5.3; the `ETag` surfaced as
  `version` and `If-Match` required on writes. Each later screen adds the calls
  it uses, so the package is shaped by its first consumer as §5 intended.
  §5.1's `actor` option is out of date (the actor is the token's subject) and
  goes. Rejected: `fetch` helpers in the app (likely rewritten as the client
  anyway), and a client generated from `openapi.json` (types from the OpenAPI
  document rather than the Zod schemas: no runtime validation, typed problems
  or compile-time `If-Match`).
- **Auth in the skeleton (open question 4, 2026-09-27).** Reads go through
  the proxy and the server prefetch without a token, and the proxy answers
  any write with a problem saying sign-in arrives in step 2. It proves the
  proxy passes `If-Match`, `ETag` and problems through, not token attachment,
  and leaves step 2 nothing to undo. Rejected: a server-held service token (a
  principal step 2 would replace) and a development sign-in (it could steer
  step 2's design, and must never reach production).
- **Step 2's direction (the user, 2026-09-27): Stytch.** The user has a
  Stytch workspace and wants sign-in through it, with users, roles and
  permissions supported properly, in the database, instead of principals in
  an environment variable (the data model's F5). Today's permission map
  (`apps/ropa-api/src/auth/permissions.ts`) and the API's own JWTs are what
  it replaces or builds on: a question for step 2's plan.
- **Testing layout (open question 5, 2026-09-27).** Components in
  `packages/ui` and the app's client components are tested in **Vitest's
  browser mode**, in a real Chromium with Playwright as the provider: Base UI
  leans on focus, keyboard, pointer events and portals, which jsdom only
  imitates. The client package and pure logic run in Node like the rest of
  the repo. Playwright's browsers are needed for end-to-end tests anyway, so
  CI gains no new dependency. **One Playwright smoke test** in this step: the
  home page lists P1–P3 read through the proxy, and a write is refused,
  against the real API with the story replayed, started by Playwright's
  `webServer` locally and by a CI job with the Postgres service container
  (migrate, seed, start both, Chromium only). Async Server Components can't
  be rendered by a component test, so pages are covered end to end. Rejected:
  jsdom (passes where a browser fails), and a stubbed API for end-to-end tests
  (can't catch the web app and the real API disagreeing).
- **Deploy in step 1 (open question 6, 2026-09-27).** `ropa-web` joins the
  Blueprint as a web service in this step, about $7 a month, accepted. The
  skeleton proves what only Render can while the app is tiny: a Next.js build
  inside the npm workspace (`transpilePackages`, the shared packages), the
  proxy reaching `ropa-api` over the private network by `hostport`, and
  whether a 512 MB instance builds and runs it. The live page shows only what
  the API already shows publicly. Rejected: staying local until step 2, when
  those surprises would come with a bigger app. Pushed only on the user's
  go-ahead.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
