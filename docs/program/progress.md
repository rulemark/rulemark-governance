# Progress Log — Build Step 1

> Design-phase log archived in `plan-archive/1/progress.md`.

## Session: 2026-09-19
- Archived the design-phase planning files to `docs/program/plan-archive/1/`
- Wrote the build step 1 plan (9 phases) in `task_plan.md`
- Files: docs/program/{task_plan,findings,progress}.md

### Phase 1 — API app foundations (complete)
Decisions taken first: packages stay source-only, `dotenv` for local environment
loading, and **test-driven development** throughout. Tests were written before
each module and are listed here with the behaviour they pin down.

- Vitest harness in `apps/ropa-api` (`vitest.config.ts`, `tsconfig.test.json`,
  `typecheck:tests` delegated from the root so test sources are type-checked too)
- `src/shared/config.ts` — Zod-validated environment, every problem reported at
  once, blank values treated as unset. Only the variables a phase uses.
- `src/shared/logger.ts` — pino, JSON on Render and pretty locally, authorization
  and cookie headers redacted, optional destination for tests
- `src/api/problems.ts` — RFC 9457 problem details, one constructor per row of
  the §1.7 status table, `ZodError` → JSON Pointer field errors
- `src/api/middleware/request-id.ts` — keeps a caller's `X-Request-Id` when it is
  short and unremarkable, otherwise generates one
- `src/api/middleware/errors.ts` — 404 handler and the problem+json error handler
- `src/api/routes/healthz.ts` — shallow health check, outside `/v1`, no token
- `src/api/app.ts` — `createApp()`, listening left to the bootstrap
- `src/index.ts` — dotenv (non-production), fail-fast config, SIGTERM/SIGINT
  graceful shutdown with a 10s grace period

Three bugs were caught by tests rather than by review: internal error detail
leaking outside development, a duplicated log line per failed request, and
`pino-http` discarding the real error on a 5xx. See findings.md.

### Phase 2 — Shared schemas package (complete)
`@rulemark/ropa-schemas`, source-only, Zod 4 as a peer dependency. 98 tests,
written before each module.

- `enums.ts` — every value list in the data model, frozen, with `RENDER_SYSTEM_KINDS`
  derived from `SYSTEM_KINDS` so the two cannot drift
- `primitives.ts` — `Slug` (never UUID-shaped), `Code`, `CountryCode`, `RegionCode`,
  `IsoDuration`, `IsoDate`, `IsoDateTime`, `AsOf`, `Uuid`, `Identifier`, `Ref`, `Cursor`
- `errors.ts` — `ProblemDetails` as a loose object, so RFC 9457 extensions survive
- `constants.ts` — `API_VERSION`, `PROBLEM_TYPE_BASE`, paging defaults
- `resources/` — Input and Output schemas for party, agreement terms, agreement,
  offering, system and the three taxonomies, plus `listResponse` and `ListQuery`
- `apps/ropa-api` now takes `ProblemDetails`, `FieldError` and `PROBLEM_TYPE_BASE`
  from the package; a contract test asserts every problem the server builds parses
  as the shared shape

**Packaging fix.** Importing the package broke `node dist/index.js`, because Node
refuses to strip types inside `node_modules`. Export conditions now serve sources
to tsx and Vitest and built output to everything else. Verified from a clean tree
with no `dist/` and no `.tsbuildinfo`.

### Between phases 2 and 3 — closing the build blind spot (2026-09-20)
- `apps/ropa-api/test/` now holds the process-level tests: `service-harness.ts`
  (shared spawn, free port, health polling, stderr capture), `bootstrap.test.ts`
  (moved from `src/index.test.ts`) and `dist.test.ts`
- `npm run test:dist` builds, then starts `dist/index.js` and checks the health
  check, the problem+json type URI that comes from the shared package, and a
  clean SIGTERM exit. Added to CI after `npm run build`
- `ropa-packages.md` §7 and `workspace-skeleton.md` §3.3 corrected: packages
  build with `tsc`; the bundler choice moves to first publish, and is no longer
  presumed to be tsup

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Phase 1 suite (40 tests, 4 files) | `npm run test` | all pass | all pass | ✅ |
| Typecheck, sources and tests | `npm run typecheck` | clean | clean | ✅ |
| Lint | `npm run lint` | clean | clean | ✅ |
| Build | `npm run build` | `dist/` without test files | as expected | ✅ |
| Dev server | `PORT=3999 npm run dev` | `/healthz` 200, 404 as problem+json | as expected | ✅ |
| Built output, production mode | `NODE_ENV=production node dist/index.js` | JSON logs, one line per request, clean SIGTERM exit | as expected | ✅ |
| Phase 2 suite (98 tests, 4 files) | `npm run test` | all pass | all pass | ✅ |
| Tests resolve to sources | delete `dist/`, `npm run test` | 149 tests still pass | as expected | ✅ |
| Clean-slate gate | delete `dist/` and `*.tsbuildinfo`, `npm run check && npm run build` | clean | clean | ✅ |
| Production entry with a package import | `NODE_ENV=production node dist/index.js` | starts and shuts down cleanly | as expected | ✅ |
| Built-artifact suite (4 tests) | `npm run test:dist` | all pass | all pass | ✅ |
| Guard actually guards | reintroduce the TypeScript entry point, run both suites | ordinary suite passes, dist suite fails | as expected | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 1, Phases 1–2 complete; Phase 3 (database foundations) next |
| Where am I going? | Phases 2–9: schemas, database, persistence, auth, endpoints, OpenAPI, CI, deploy |
| What's the goal? | A running, authenticated, documented API on Render with foundation records working end to end |
| What have I learned? | See findings.md |
| What have I done? | Design complete and pushed; monorepo scaffolded; the API app boots, logs, handles errors and shuts down cleanly; the shared schemas package defines every foundation shape and the API consumes it |
