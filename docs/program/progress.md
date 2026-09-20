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

## Session: 2026-09-20
- Fixed `docker-compose.yml`: `postgres:18` refuses to start when the volume is
  mounted at `/var/lib/postgresql/data`. Mount the parent instead. The volume was
  empty, so nothing was lost
- Added a `pg_isready` healthcheck to the db service
- Verified Postgres 18.6 answers on `localhost:5432` with the `.env.example`
  credentials, and that `uuidv7()` works without an extension
- Created the local `.env` from `.env.example` (git-ignored). Confirmed dotenv
  reads every variable, that `PRINCIPALS` survives as parseable JSON, that
  `LOG_LEVEL=debug` from `.env` reaches the running service, and that a shell
  variable still overrides it
- Confirmed the suites pass identically with and without `.env`, so no test
  depends on a developer having one
- README getting-started now includes `cp .env.example .env`

### Phase 3 — Database foundations (complete)
- `DATABASE_URL` added to the config schema, validated as a postgres connection
  string; `.env.example` is now checked against the required list by a test
- `src/db/schema/`: checks and column helpers, then party, agreement_terms,
  offering, agreement, system, the three taxonomies, revision, event_outbox and
  code_counter — eleven tables, matching `ropa-database.md` §4.2, §4.3, §4.5
- `drizzle/0000_foundation_records.sql` generated and reviewed against §4; two
  defects found and fixed before it was ever applied (see findings)
- `drizzle/0001_triggers_and_code_counters.sql` hand-written: `set_updated_at`
  on the ten editable tables, the generic `forbid_immutable_change` function for
  step 2, `revision_append_only` on `revision`, and the four counter rows
- `src/db/client.ts` and `src/db/migrate.ts`, the latter taking a Postgres
  advisory lock so two instances starting together cannot both migrate
- `src/shared/startup.ts`: `.env` loading and fail-fast config, shared by the
  service and the migrator
- 26 database tests against real Postgres, one per named constraint plus the
  triggers, code allocation and the migration itself
- CI now fails on Drizzle schema/migration drift

### Phase 4 — Persistence machinery (complete)
- `src/domain/concurrency.ts` — `ETag` from the version, `If-Match` parsing with
  428 and 400; `*` is refused because honouring it would skip the check the
  header exists for
- `src/domain/snapshots.ts` — one hand-written schema per entity, stamped with
  `schemaVersion`. Written by hand on purpose: generating them from the tables
  would silently redefine history whenever a column changed
- `src/domain/codes.ts` — allocation from `code_counter` inside the transaction
- `src/domain/events.ts` — the `record.changed` envelope, one outbox row per
  destination
- `src/domain/aggregate.ts` — create, update and delete as the §6.1 sequence:
  version check in the `UPDATE` itself, revision snapshot, outbox rows, commit
- `src/domain/identifiers.ts` — id, code or slug told apart without a query
- `src/domain/aggregates.ts` — the rows ↔ aggregate mapping for all eight
  foundation records
- `Problem` moved to `src/shared/` so the domain need not import from `api/`
- 21 new database tests, including a real (committing) transaction test that
  proves the record, its history and its events land together or not at all

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
| Phase 3 database suite (26 tests) | `npm run test` | all pass against Postgres 18.6 | all pass | ✅ |
| Migrations on an empty database | `DROP DATABASE`, `CREATE DATABASE`, `npm run db:migrate` | 11 tables, 4 counter rows, 11 triggers | as expected | ✅ |
| Schema/migration drift | `npm run db:generate` | "No schema changes" | as expected | ✅ |
| Whole gate from nothing | empty database, no `dist/`, no `.tsbuildinfo` | 185 tests pass | as expected | ✅ |
| Phase 4 persistence suite | `npm run test` | save, concurrency, codes, identifiers | all pass | ✅ |
| Atomicity, for real | `db.transaction()` on its own connection, made to throw | no row, no revision, no outbox row | as expected | ✅ |
| Whole gate from nothing, twice | fresh database, no build artifacts, run twice | 216 tests pass both times | as expected | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 1, Phases 1–4 complete; Phase 5 (authentication and authorization) next |
| Where am I going? | Phases 2–9: schemas, database, persistence, auth, endpoints, OpenAPI, CI, deploy |
| What's the goal? | A running, authenticated, documented API on Render with foundation records working end to end |
| What have I learned? | See findings.md |
| What have I done? | Design complete and pushed; monorepo scaffolded; the API app boots, logs, handles errors and shuts down cleanly; the shared schemas package defines every foundation shape and the API consumes it; eleven tables exist in Postgres with their constraints and triggers proven by test; records save with versioning, revisions and outbox rows in one transaction |
