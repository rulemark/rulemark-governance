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

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from RoPA step 5 | `npm run check` | 1175 tests pass | 1175 pass (890 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 1: the button, before it exists | `npx vitest run` in `packages/ui` | fails on the missing module | `Failed to resolve import "./button"` | ✅ |
| Phase 1: mutations | five deliberate breaks | each fails a test | 1 or 2 failures each; all 8 pass restored | ✅ |
| Phase 1 | `npm run check` | 1183 tests pass | 1183 pass (890 api, 262 schemas, 14 audit-log, 8 ui, 9 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-09-27 | Every button test: `Cannot read properties of null (reading 'useRef')` | Cache cleared: passed; reproduced by running before the component existed | `optimizeDeps.include`: React, the renderer, `@base-ui/react/**` |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Interface step 1 (the workspace skeleton), Phase 2 (the app) not started; Phase 1 done and committed, not pushed |
| Where am I going? | The app, the proxy and first page, tests and CI, then deploy and docs |
| What's the goal? | A Next.js app and a shadcn component package in the workspace, reading the record through the proxy, tested from the first commit |
| What have I learned? | See findings.md |
| What have I done? | The RoPA API is built and deployed (steps 1–5); the story's Parts II and III and the roadmap set the interface as next |
