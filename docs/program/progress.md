# Progress Log — Interface Step 1

> The RoPA API's step 5 log is archived in `plan-archive/6/progress.md`.

## Session: 2026-09-27
- The user chose the interface as the next priority, and its stack: Next.js,
  TypeScript, TanStack Query, Tailwind, shadcn/ui in a package of its own,
  Vitest and Playwright; the first step is the workspace skeleton
- Checked current versions and shadcn's monorepo guidance
- Wrote the step 1 plan (5 phases, 6 open questions) in `task_plan.md`, with
  a proposed build order for the interface
- Settled the six open questions, one at a time: `@rulemark/ui` source-only,
  on Base UI, Nova, neutral with dark mode; server prefetch and hydration;
  `@rulemark/ropa-client` built now and grown by screens; anonymous reads and
  writes refused until step 2, which brings Stytch and users, roles and
  permissions in the database; Vitest browser mode and a seeded Playwright
  smoke test; `ropa-web` deployed in this step (about $7 a month)

### Phase 1: The component package (complete, committed, not pushed)
- Generated shadcn's monorepo scaffold (`init --monorepo --base base --preset
  nova`) in a scratch directory, to see exactly what it makes for the
  package, and ported `components.json`, `globals.css` and `postcss.config`
  into `packages/ui` as `@rulemark/ui`, on npm and the repo's configs
- Wrote the button's eight tests first (they failed on the missing module),
  then ran `shadcn add button` from the package: identical to the scaffold's
- Every test failed once, then passed with Vite's optimiser cache cleared:
  reproduced (a dependency first seen mid-run, against an older cache), and
  fixed by pre-bundling React, the renderer and all of Base UI
- Broke the code five ways (no dark palette, no `bg-primary`, no class
  merge, a plain `<button>`, `disabled` dropped): each fails a test
- Wired in: the root `tsconfig.json` references, `eslint-plugin-react-hooks`
  for `.tsx` (checked with a conditional hook), Prettier on the generated
  files, root Vitest 5.0.1 → 5.0.2, Chromium installed in CI

### Phase 1b: The Rulemark theme (complete, committed, not pushed)
- The user added `packages/ui/ux/`: `rulemark-colors.css` (tokens v1) and
  seven logo SVGs, to be the global theme
- Settled open questions 7–9, one at a time: the Rulemark file's
  `data-theme` with the OS fallback (next-themes `attribute="data-theme"`);
  shadcn's names bridged onto `--rm-*`, `field` for the field background, the
  button restyled to the spec; the colour file in `src/styles/`, logo
  components, the SVGs kept in `src/brand/` and `ux/` removed
- Counted the colour names all 61 base-nova components use (in the scratch
  scaffold) and the CSS variables they read directly, to shape the bridge
- Tests first: the theme chosen four ways, emulating the OS's preference
  through a custom browser command; the bridge and utilities in both themes;
  the base styles; the button's states; each logo against its light and dark
  files. All failed on the missing tokens and module
- Built it: the colour file's `@theme` edited (`field`; `input` and
  `secondary` left to the bridge), `globals.css` rewritten as the bridge,
  the button's variants restyled, the logos generated from the files
- Thirteen deliberate breaks, each failing its tests
- `npm run check` twice failed in `ropa-api`, never in this change: a VS Code
  helper answering on `127.0.0.1` at the port a test had been given (see
  findings); the third run passed
- Fixed that on the user's go-ahead, as its own commit (`5eebf6a`): the
  fifteen files start their servers with `listenOnLoopback()`, which binds
  127.0.0.1 and waits for `listening` (the first attempt, bare
  `listen(0, '127.0.0.1')`, broke two files reading the port at once); a
  lint rule points new tests to it; its own three tests, each break caught
- The user added `rulemark-foundations.css` (typography, spacing, radius);
  settled open questions 10–12 one at a time: shadcn's radius steps at the
  spec's values, the spec's control sizes, Geist through `geist` and
  `next/font` in Phase 2
- Found `cn` blind to the foundations' names (`text-label` dropped beside
  `text-primary-fg`; `h-control h-12` both kept), and that `shadcn add`
  writes `from 'cn'` whatever `lib/utils` holds; configured `cn` in
  `lib/utils.ts` and added a lint rule, which caught `logo.tsx` at once
- Tests first (76 failing, then 47 with the undefined-token guard), built,
  ten deliberate breaks

### Phase 2: The app (complete, committed, not pushed)
- `apps/ropa-web` on Next.js 16.3.6 and React 19.3: the TypeScript, Next,
  PostCSS and shadcn configuration; `next.config.ts` loading the root `.env`
  in development, compiling `@rulemark/ui`, rooted at the workspace
- Tests first, in two Vitest projects (Node; Chromium): the configuration,
  `/healthz`, the startup check, the query client, the favicon, the
  providers, the theme toggle, the header; all failed on missing modules
  (the favicon's passed at once, being copied first: broken on purpose later)
- Built: `loadConfig` (as the API reads a service address), the startup
  check in `instrumentation.ts` with its Node-only half in `lib/startup.ts`,
  TanStack Query's server/browser client, the providers (next-themes on
  `data-theme`), a theme toggle cycling system, light and dark, the header
  with the lockup, the layout with Geist through `next/font`, a placeholder
  home page
- Ran it: `next build` needs no `ROPA_API_URL`; `next start` without it
  exits 1 with `ROPA_API_URL: Required`; with it, `/healthz`, the page (Geist
  preloaded, the theme script, the lockup, the favicon) and screenshots in
  light and dark; a theme chosen survives a reload
- `shadcn add badge` from the app: the file lands in `packages/ui`, the lint
  rule flags its `cn` import; removed
- Found the scaffold's `@source` for the apps pointing at `packages/apps`
  (never scanned); now `apps/ropa-web/src`
- Root helper scripts (`db:*`, `openapi:write`, `test:dist`, `demo:data`)
  build with `tsc --build`, so `npm run build`'s Next build runs once; Next
  telemetry off in the app's scripts
- Ten deliberate breaks, each failing its tests
- The user asked to see it running: `npm run dev -w apps/ropa-web` stopped
  with `ROPA_API_URL: Required`, the root `.env` never read (every earlier
  check had passed the variable explicitly). `@next/env`'s cache; replaced
  with `loadRootEnvFile()`, tested first; the dev server then served
- `next dev` wrote `AGENTS.md` and `CLAUDE.md` (Next's agent rules); on the
  user's choice, the block lives in `CLAUDE.md` alone, which Next keeps
  without recreating `AGENTS.md` (checked on a restart)

### Phase 3: The proxy and the first page (complete, committed, not pushed)
- Read the contract (an Explore agent): `GET /v1/activities`, `{ data,
  nextCursor }`, 50 a page; problems as `application/problem+json`; reads
  public by default; the seed's C1–C4 and P1–P3
- `@rulemark/ropa-client`: configured like `ropa-schemas`; 20 tests first,
  against a stub HTTP server, then the typed errors and the core with
  `activities.list`; eight breaks (one uncaught, so a test for filters set
  to `undefined` was added)
- The proxy, tests first against a stub API (19): reads, problems, ETag and
  304, HEAD, cookies and credentials held back, `/v1` only, writes refused,
  502 and 504; the route handler tested as Next calls it
- `shadcn add table` from the app (second use of the workflow), restyled to
  the foundations, 10 tests first; they found shadcn's headers exposed as
  cells, so `TableHead` defaults to `scope="col"`
- Queries and the list, tests first: shared keys, the signal, the retry
  policy, the list's rows, loading, empty, error and retry, and prefetched
  data shown without a request. Vitest 5's `toHaveTextContent` matches
  exactly: partial and regex checks are `toMatchTextContent`
- Ran it against the story (a second API on 3100 over the test database,
  the user's API and database on 3000 untouched): the server's HTML has all
  seven rows, the browser makes no request on load; the proxy passes the
  list, the ETag, a 404 problem, refuses a PUT, and 404s `/healthz`
- That run found three things, each fixed test-first where a test could
  show it: `If-None-Match` never got a 304 (fetch adds `Cache-Control:
  no-cache`); with the API down the page waited 3 s for the server's
  retries; `next build` used the packages' `dist/`, which nothing built
- `next dev` then failed: Turbopack won't map the packages' `./x.js`
  imports to `./x.ts`. The user chose `.ts` specifiers with
  `rewriteRelativeImportExtensions` (98 in 39 files of `ropa-schemas` and
  `ropa-client`); the built JavaScript still imports `.js`; `tsx`, Vitest,
  Turbopack and `tsc` all resolve it; `next dev` served the seven rows
- Twelve more breaks across the proxy, queries, list and table, each caught
- The user asked why not Next's rewrites: tested that a rewrite's
  destination is fixed at build (built against one stub, started against
  another: the build's won), and agreed the Route Handler's case rested on
  auth that step 1 doesn't have. Switched: the Route Handler, `proxy.ts` and
  their tests removed; `ropaRewrites()` and three tests first; CI sets
  `ROPA_API_URL` (typegen evaluates the rewrite too); the root `.env` is now
  read whenever it exists, so a local build and typegen find it
- Against the story again: the list, a query, the ETag, a 304, the API's
  404 problem, a write's 401 problem, `/api/ropa/healthz` a 404, seven rows
  server-rendered; with the API down, a 500 in 8 ms and the error after the
  retries, now in plain words (test first); four more breaks, each caught

### Phase 4: Tests and CI (complete, committed, not pushed)
- `@playwright/test` 1.63 and `pg` in the web app (dev), `concurrently` at
  the root
- The smoke test's database, `ropa_e2e` (or `E2E_DATABASE_URL`), created
  from the `postgres` database if missing; Playwright's `webServer` creates,
  migrates, seeds and starts the built API, then builds and starts the web
  app, which compiles the API's address into its rewrite
- First runs "exited early": two leftover proxies from another Claude
  session (Sep 22, another project) held 3200 and 3201, answering 502;
  left alone, and the test moved to 3310 and 3311 with
  `reuseExistingServer: false`, so a taken port stops the run
- Six tests pass (about 9 s after the builds); three breaks (no server
  prefetch, the rewrite open to every path, no rewrite), each caught
- `npm run dev` runs both apps; checked on 3400 against `ropa_e2e` (the
  user's API holds 3000): both served, one Ctrl-C stopped both
- CI: an `e2e` job beside `check`, its own Postgres service, Chromium,
  `npm run test:e2e`, the report and traces uploaded on failure; run
  locally with `CI=1`

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from RoPA step 5 | `npm run check` | 1175 tests pass | 1175 pass (890 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 1: the button, before it exists | `npx vitest run` in `packages/ui` | fails on the missing module | `Failed to resolve import "./button"` | ✅ |
| Phase 1: mutations | five deliberate breaks | each fails a test | 1 or 2 failures each; all 8 pass restored | ✅ |
| Phase 1 | `npm run check` | 1183 tests pass | 1183 pass (890 api, 262 schemas, 14 audit-log, 8 ui, 9 dist) | ✅ |
| Phase 1b: before the code | `npx vitest run` in `packages/ui` | the new tests fail | 104 failed: tokens undefined, `./logo` missing | ✅ |
| Phase 1b: breaks | thirteen deliberate breaks | each fails its tests | 1 to 15 failures each, the intended ones | ✅ |
| Phase 1b: stability | `npx vitest run` in `packages/ui`, four times | 133 pass each time | 133 × 4 | ✅ |
| Phase 1b | `npm run check` | 1308 tests pass | 1308 pass (890 api, 262 schemas, 14 audit-log, 133 ui, 9 dist); two earlier runs hit the port collision | ✅ |
| API test servers on loopback | `npm run test` in `ropa-api` and `audit-log`, twice | all pass | 893 and 14, both times | ✅ |
| Phase 1b: foundations breaks | ten deliberate breaks | each fails its tests | 1 to 51 failures each, the intended ones | ✅ |
| Phase 1b: foundations | `npm run check` | 1411 tests pass | 1411 pass (893 api, 262 schemas, 14 audit-log, 233 ui, 9 dist) | ✅ |
| Phase 2: before the code | `npx vitest run` in `apps/ropa-web` | fails on missing modules | every file but the favicon's | ✅ |
| Phase 2: breaks | ten deliberate breaks | each fails its tests | 1 to 3 failures each, the intended ones | ✅ |
| Phase 2: startup | `next start` without `ROPA_API_URL` | exits 1, naming it | `ROPA_API_URL: Required`, exit 1 | ✅ |
| Phase 2: serving | `next start`, then `/healthz`, `/`, `/icon.svg`, screenshots | 200s, Geist, both themes | as expected; the theme survives a reload | ✅ |
| Phase 2 | `npm run check`; `npm run build` | 1436 tests pass; the build succeeds | 1436 pass (893 api, 262 schemas, 14 audit-log, 233 ui, 25 web, 9 dist); built; 29 web tests with the root `.env` loader | ✅ |
| Phase 2: development | `npm run dev -w apps/ropa-web`, the root `.env` only | serves on 3001 | first failed (`ROPA_API_URL: Required`); after the fix, `/` and `/healthz` 200 | ✅ |
| Phase 3: before the code | the new tests | fail on missing modules | client 19/19, proxy and route, table 10/10, queries and list | ✅ |
| Phase 3: breaks | twenty deliberate breaks | each fails its tests | all caught after one added test | ✅ |
| Phase 3: against the story | `next start` on 3001, the API on 3100 | seven rows server-rendered; proxy behaviour | as expected, after three fixes (304, server retries, build order) | ✅ |
| Phase 3: the API down | the page, with 3100 stopped | renders at once, then the error | 200 in ~200 ms, three 502s, the alert at ~3.5 s | ✅ |
| Phase 3: development | `next dev` and the API's `tsx` dev, after the `.ts` imports | the seven rows | served | ✅ |
| Phase 3 | `npm run check` | 1509 tests pass | 1509 pass (893 api, 262 schemas, 14 audit-log, 243 ui, 20 client, 68 web, 9 dist) | ✅ |
| Phase 3: the rewrite | build against one stub API, start against another | learn which a rewrite uses | the build's | ✅ |
| Phase 3: after the switch | `npm run check`; a root build reading only `.env` | 1492 tests pass; built | 1492 pass (51 web, the proxy's 20 gone, 3 rewrite tests in); built | ✅ |
| Phase 4: smoke | `npm run test:e2e` | 6 pass | 6 pass (9 s, after both builds) | ✅ |
| Phase 4: breaks | three deliberate breaks | each fails a smoke test | 1, 1 and 2 failures, the intended ones | ✅ |
| Phase 4: as CI | `CI=1 npm run test:e2e` | 6 pass, GitHub reporter | 6 pass; run summary; report written, ignored by git | ✅ |
| Phase 4: both apps | `npm run dev` (API on 3400) | both serve; Ctrl-C stops both | as expected | ✅ |
| Phase 4 | `npm run check` | 1492 tests pass | 1492 pass | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-09-27 | Every button test: `Cannot read properties of null (reading 'useRef')` | Cache cleared: passed; reproduced by running before the component existed | `optimizeDeps.include`: React, the renderer, `@base-ui/react/**` |
| 2026-09-27 | The button's focus outline 3px, not 2px | Listed the matching rules in the browser: only Rulemark's | `transition-all` animates it in: the test polls |
| 2026-09-27 | `ropa-api`, 12 then 21 tests: 401 with `authentication_error` from `POST /v1/tokens` | The body isn't the API's; `curl` found it at a VS Code helper on `127.0.0.1:52173` | A test's `listen(0)` on `::` given a port another process holds on `127.0.0.1`; fixed in `5eebf6a` with `listenOnLoopback()` |
| 2026-09-27 | Two API files: `Cannot read properties of null (reading 'port')` | With a host, `listen` binds asynchronously | `listenOnLoopback()` awaits `listening` |
| 2026-09-27 | `tsc --build`: the inferred type of `cn` can't be named | Declarations need a portable type | Annotated `CnFunction` |
| 2026-09-27 | The header's tests: `process is not defined` | `next/link` reads `process.env`, which only Next defines | `define: { 'process.env': '{}' }` in the browser project |
| 2026-09-27 | Playwright: "Process from config.webServer exited early" | 127.0.0.1:3200 answered 502 before the API started: leftover proxies from another session on 3200 and 3201 | Ports 3310 and 3311, `reuseExistingServer: false` |
| 2026-09-27 | `next dev`: `ROPA_API_URL: Required`, though the root `.env` sets it | `@next/env`'s `loadEnvConfig` returns its cached first load (the app directory's) | `loadRootEnvFile()`, reading the root `.env` with `util.parseEnv`, never overriding |
| 2026-09-27 | The proxy: `If-None-Match` never gets a 304 | The API answers 304 directly; fetch adds `Cache-Control: no-cache` to conditional requests | Forward the browser's `Cache-Control`, else send `max-age=0` |
| 2026-09-27 | The page waits 3 s with the API down | The server's prefetch retried twice | No retries on the server |
| 2026-09-27 | `next build` without the packages' `dist/`: `Can't resolve '@rulemark/ropa-client'` | Production resolves the `default` condition | The app's `build` runs `tsc --build ../../packages/ropa-client` first |
| 2026-09-27 | `next dev`: `Can't resolve './client.js'` | Turbopack doesn't map `.js` to `.ts`; `extensionAlias` is webpack-only | `.ts` specifiers in the packages, `rewriteRelativeImportExtensions` (user's choice) |
| 2026-09-27 | `toHaveTextContent(/…/)` fails on matching text | Vitest 5 made it an exact match | `toMatchTextContent` |
| 2026-09-27 | `getByRole('columnheader')` finds nothing | shadcn's `<th>` has no `scope`; Chromium exposes it as a cell | `scope="col"` by default |
| 2026-09-27 | `next build`: Node API (`process.stderr`) not supported in the Edge Runtime | Next compiles `instrumentation.ts` for both runtimes | The Node-only half in `lib/startup.ts`, imported under `process.env.NEXT_RUNTIME === 'nodejs'` |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Interface step 1 (the workspace skeleton), Phase 5 (deploy and docs) not started; Phases 1 to 4 done and committed, not pushed |
| Where am I going? | Deploy `ropa-web` on Render and the docs |
| What's the goal? | A Next.js app and a shadcn component package in the workspace, reading the record through the proxy, tested from the first commit |
| What have I learned? | See findings.md |
| What have I done? | The RoPA API is built and deployed (steps 1–5); the story's Parts II and III and the roadmap set the interface as next |
