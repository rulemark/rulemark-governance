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

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-09-27 | Every button test: `Cannot read properties of null (reading 'useRef')` | Cache cleared: passed; reproduced by running before the component existed | `optimizeDeps.include`: React, the renderer, `@base-ui/react/**` |
| 2026-09-27 | The button's focus outline 3px, not 2px | Listed the matching rules in the browser: only Rulemark's | `transition-all` animates it in: the test polls |
| 2026-09-27 | `ropa-api`, 12 then 21 tests: 401 with `authentication_error` from `POST /v1/tokens` | The body isn't the API's; `curl` found it at a VS Code helper on `127.0.0.1:52173` | A test's `listen(0)` on `::` given a port another process holds on `127.0.0.1`; fixed in `5eebf6a` with `listenOnLoopback()` |
| 2026-09-27 | Two API files: `Cannot read properties of null (reading 'port')` | With a host, `listen` binds asynchronously | `listenOnLoopback()` awaits `listening` |
| 2026-09-27 | `tsc --build`: the inferred type of `cn` can't be named | Declarations need a portable type | Annotated `CnFunction` |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Interface step 1 (the workspace skeleton), Phase 2 (the app) not started; Phases 1 and 1b done and committed, not pushed |
| Where am I going? | The app, the proxy and first page, tests and CI, then deploy and docs |
| What's the goal? | A Next.js app and a shadcn component package in the workspace, reading the record through the proxy, tested from the first commit |
| What have I learned? | See findings.md |
| What have I done? | The RoPA API is built and deployed (steps 1–5); the story's Parts II and III and the roadmap set the interface as next |
