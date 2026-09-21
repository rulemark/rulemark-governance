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

### Phase 5 — Authentication and authorization (complete)
- `@rulemark/ropa-schemas`: `PERMISSIONS` and `ROLES`, plus `Principal`,
  `TokenRequest`, `TokenResponse` and `MeResponse`
- Config: `JWT_SECRET`, `TOKEN_MINT_SECRET` (both required, 16 characters
  minimum, no defaults), `PRINCIPALS` parsed and validated as JSON with unique
  subjects, `REQUIRE_AUTH_FOR_READS` and `AUTH_DISABLED`, the latter refused in
  production
- `src/auth/permissions.ts` — the role map, server-authoritative
- `src/auth/tokens.ts` — HS256 through `jose`, eight-hour expiry, per-token
  `jti`, claims validated on verify
- `src/api/middleware/authenticate.ts` — who is calling, and `actorFor`
- `src/api/middleware/authorize.ts` — `requires(permission)`, 401 against 403
- `src/api/routes/auth.ts` — `POST /v1/tokens` (rate limited, constant-time
  secret comparison) and `GET /v1/me`
- CI and the service harness carry test values for the new required variables

### Phase 6 — Foundation record endpoints (complete)
- `src/domain/slug.ts` — derives a slug from the name, folding accents, and
  gives up rather than inventing one
- `src/domain/pagination.ts` — opaque keyset cursors over UUIDv7 ids
- `src/domain/refs.ts` — one query per referenced table per page, not per row
- `src/api/resources/resource-router.ts` — list, create, read, replace, delete
  and the two history routes, built once from a resource definition
- `src/api/resources/definitions.ts` — the six record types: their schemas,
  references, cross-table rules and filters
- `src/index.ts` now owns the pool and closes it after the server, so in-flight
  requests keep their connections
- 31 endpoint tests walking the Hireloop story over HTTP, plus the live tour

### Phase 7 — OpenAPI and docs (complete)
- `src/api/openapi/document.ts` — the OpenAPI 3.1 document, schemas from Zod 4's
  own `toJSONSchema`, paths derived from the resource definitions
- `src/api/routes/docs.ts` — `GET /openapi.json` and `GET /api-docs`, neither
  needing a token
- `src/api/openapi/write.ts` and `npm run openapi:write` — writes the document
  into `packages/ropa-client/openapi.json`; CI fails if it is stale
- Filters became declarative, so the router applies them and the document
  describes them from one statement
- The intermittent test failure was tracked down to supertest's per-request
  ephemeral servers; each file now starts one server and reuses it

### Phase 8 — CI and test hardening (complete)
- `npm run check` is now the whole gate: typecheck, lint, format:check, test,
  test:dist. CI runs the same plus the two drift checks, which need git
- CI hardened: `permissions: contents: read`, a ten-minute timeout, and a
  concurrency group that supersedes superseded runs except on main
- `format:check` added — it had never been verified, and found seven files
- Generated files are Prettier-ignored, so the formatter and the generators
  cannot disagree
- Dead code removed; the one "unused" export that mattered led to snapshots
  being validated on read as well as on write (DB §6.2)
- Coverage tooling added: 95% of statements, with the child-process entry
  points excluded and the reason recorded
- README fixed: it told a newcomer to run a script that does not exist

### Demo data over HTTP (2026-09-20)
- `src/demo/dataset.ts` and `src/demo/seed.ts`, run with `npm run demo:data`:
  39 foundation records — the Hireloop cast, terms, the ATS offering, three
  agreements, four systems and the three taxonomies
- Idempotent by lookup, so a second run reports everything already present
- Works against any base URL (`DEMO_API_URL`), which is how a deployed service
  or a Render preview environment gets filled, and doubles as a smoke test
- `svc:seed` (admin) added to `.env.example`: taxonomy writes need
  `taxonomy:write`, which no existing principal had
- Tests moved to their own database (`ropa_test`, created by the global setup).
  Demo data in the development database had broken twelve of them

### Input bounds and readable examples (2026-09-21)
- Every identifier and text field in `@rulemark/ropa-schemas` is now bounded:
  slug 100, code 20, name 200, text 2000, email 254, URL 2048
- `slugCheck` bounds length in the database too (migration 0002)
- Schemas carry `.meta({ examples })`, so Swagger UI shows real values
- `db:generate` builds first; a test rejects any check constraint containing
  `undefined` or `NaN`

### `trust proxy` corrected (2026-09-21)
- `trust proxy` 1 → 2: Render's edge is behind Cloudflare, so `req.ip` was
  resolving to an edge node rather than the caller, and the token rate limiter
  keys on it
- `trust-proxy.test.ts` pins it, including that a prepended address is ignored
- The request log now carries `client.ip` and `client.ips`

### First deployment verified (2026-09-21)
- https://ropa-api.onrender.com, Frankfurt, behind Render's edge and Cloudflare
- Two deploys through the full loop: push → CI green → Render deploys. The
  second carried migration 0002, applied by the pre-deploy command against the
  live database with the previous version still serving
- Verified on the deployed service: the docs, an over-long slug refused with a
  422 naming `/slug`, a party created with its slug derived from the name, and
  its revision recording `actor: priya.raman` from the token's subject

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
| Phase 5 auth suite | `npm run test` | permissions, tokens, endpoints, actor | all pass | ✅ |
| Viewer refused a write | `POST /v1/parties` with a viewer token | 403 naming `record:write` | as expected | ✅ |
| Revision records the token's subject | write with a token plus a contradicting `X-Actor` | `revision.actor` is the token's `sub` | as expected | ✅ |
| Live demo tour | `npm run dev`, mint, `/v1/me`, wrong secret | token minted, permissions listed, 401 on a bad secret | as expected | ✅ |
| Whole gate | `npm run check` and `npm run test:dist` | 274 tests | all pass | ✅ |
| Hireloop record through the API | `POST` parties, terms, offering, agreements | created, with Refs resolved | as expected | ✅ |
| Paging walks the whole set | `?limit=2` followed to the last cursor | every row once, no repeats | as expected | ✅ |
| Delete while referenced | `DELETE` terms an offering uses | 409 problem+json | as expected | ✅ |
| Whole gate, three times | `npm run test` | 318 tests | all pass each time | ✅ |
| Robust to leftover data | live demo rows left in the database, then the suite | unaffected | as expected | ✅ |
| Document is valid OpenAPI 3.1 | `SwaggerParser.validate` in a test | valid | valid | ✅ |
| Every documented route is routable | 60 operations against the app | none answer "No route for" | as expected | ✅ |
| That guard can fail | document a path the router does not serve | the test fails | as expected | ✅ |
| Swagger UI and the authorize flow | `/api-docs`, then mint → bearer → create a party | 200, then 201 | as expected | ✅ |
| Flake rate | 20 consecutive full runs after the server-reuse fix | 0 failures | 0 failures | ✅ |
| Whole gate, one command | `npm run check` | typecheck, lint, format, 400 tests | all pass | ✅ |
| Coverage | `npm run coverage` | no meaningful gaps | 95% statements, 96% lines | ✅ |
| README getting-started | followed from a clean clone | every command exists | fixed (db:seed did not) | ✅ |
| Demo data over HTTP | `npm run demo:data` | records created | 38 created, 1 already there | ✅ |
| Idempotent | run it a second time | nothing changes | 0 created, 39 already there | ✅ |
| Tests isolated from dev data | demo data loaded, then the suite | unaffected | 305 pass, test database separate | ✅ |
| Unbounded input | 5,000-char slug, 1 MB name | rejected | rejected, in Zod and in Postgres | ✅ |
| `req.ip` behind two proxies | `x-forwarded-for: caller, edge` | the caller | was the edge; fixed and pinned | ✅ |
| Authenticated write, deployed | `POST /v1/parties` with a minted token | 201, revision names the token's subject | as expected | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 1, Phases 1–8 complete; Phase 9 deployed and verified by hand, Blueprint (9b) remaining |
| Where am I going? | Phases 2–9: schemas, database, persistence, auth, endpoints, OpenAPI, CI, deploy |
| What's the goal? | A running, authenticated, documented API on Render with foundation records working end to end |
| What have I learned? | See findings.md |
| What have I done? | Design complete and pushed; monorepo scaffolded; the API app boots, logs, handles errors and shuts down cleanly; the shared schemas package defines every foundation shape and the API consumes it; eleven tables exist in Postgres with their constraints and triggers proven by test; records save with versioning, revisions and outbox rows in one transaction; tokens are minted and permissions enforced per route; all six foundation record types are createable, readable, replaceable and deletable over HTTP, with history; the API documents itself and Swagger UI can drive it; the gate is one command and CI runs it |
