# Task Plan: RoPA Build Step 1

## Goal
Ship the foundation of the RoPA service: a running, documented, authenticated Express + Drizzle API on Render, with the foundation records (parties, agreements, offerings, systems, taxonomies) fully working end to end — records, history and events included.

Build step 1 from `docs/ropa/ropa-api.md` §8. Activities (the discriminated union, role rules, lifecycle) are **step 2**, but every mechanism they need is built here.

## Current Phase
Phases 1–3 complete. Phase 4 (persistence machinery) next.

## Definition of done for step 1
- `npm run dev` serves the API locally; `/healthz`, `/openapi.json` and `/api-docs` respond.
- A token can be minted and used; permissions are enforced per route.
- Foundation records support create, read, update, delete, list and filter, with versioned saves, revisions and outbox rows written in the same transaction.
- Tests pass against a real Postgres in CI, including the two drift checks.
- The service runs on Render from `render.yaml`, with migrations applied by the pre-deploy command.

## Phases

### Phase 1: API app foundations
Reference: `ropa-api.md` §1, `ropa-database.md` §11, `ropa-packages.md` §2
- [x] `apps/ropa-api` dependencies: express, zod, pino, dotenv, tsx, vitest, supertest
- [x] Vitest set up in `apps/ropa-api` (the harness every later phase writes tests into)
- [x] Config module: Zod-validated environment, fails fast with a clear message
- [x] App bootstrap: server, graceful shutdown, request ID, structured logging
- [x] `GET /healthz` (Render health check)
- [x] Error handling: RFC 9457 `application/problem+json`, field-level `errors[]`, status mapping (§1.7)
- [x] `npm run dev` works
- **Done when:** the server starts, `/healthz` returns 200, a deliberate error returns problem+json, and `npm run test` passes
- **Status:** complete — 40 tests, `npm run check` and `npm run build` clean, verified against both `npm run dev` and the built output

### Phase 2: Shared schemas package
Reference: `ropa-packages.md` §4, `ropa-database.md` §1
- [x] `packages/ropa-schemas`: zod 4 peer dependency, source-only exports (tsup deferred to first publish)
- [x] `enums`: every value list from DM (shared by Zod and Drizzle checks)
- [x] `primitives`: Slug, Code, CountryCode, IsoDuration, Ref, Cursor, AsOf
- [x] `errors`: ProblemDetails; `constants`: API_VERSION
- [x] Input/Output schemas for the foundation records (party, agreement terms, agreement, offering, system, taxonomies)
- [x] Export conditions so the built service can load the package (see findings)
- **Done when:** `apps/ropa-api` imports the package and type-checks against it
- **Status:** complete — 98 package tests, a cross-package contract test in the API, `npm run check` and `npm run build` clean from an empty tree

### Phase 3: Database foundations
Reference: `ropa-database.md` §3, §4, §8
- [x] Drizzle setup: `drizzle.config.ts`, client, snake_case casing
- [x] Check helpers (`slugCheck`, `inList`) and the shared conventions (§3)
- [x] Schema for foundation tables: party, agreement_terms, agreement, offering, system, taxonomies, code_counter, revision, event_outbox
- [x] First generated migration; review the SQL against §4 — caught two defects before it was applied
- [x] Custom migration: `set_updated_at`, `forbid_immutable_change`, `revision_append_only`, seed `code_counter`
- [x] `db:migrate` script (Drizzle migrator + advisory lock) against Docker Postgres 18
- [x] `DATABASE_URL` in the config schema, with a `.env.example` drift guard
- [x] Drizzle drift check enabled in CI (brought forward from Phase 8)
- **Done when:** migrations apply to an empty database and constraints reject bad data by hand
- **Status:** complete — 26 database tests, one per named constraint; verified from a dropped and recreated database

### Phase 4: Persistence machinery
Reference: `ropa-database.md` §5, §6; `ropa-api.md` §1.4, §1.8
- [ ] Code allocation from `code_counter` inside the transaction
- [ ] Aggregate save: version check → validate → children diff → revision snapshot → outbox rows, one transaction
- [ ] Snapshot format with `schemaVersion` and its own Zod schema
- [ ] Optimistic concurrency: `ETag`, `If-Match`, 412/428
- [ ] Repository pattern: rows ↔ aggregates mapping, Ref resolution
- **Done when:** saving a record twice produces two revisions, and a stale `If-Match` returns 412
- **Status:** pending

### Phase 5: Authentication and authorization
Reference: `ropa-api.md` §1.9, §1.6
- [ ] `PRINCIPALS` config parsing; `jose` HS256 signing
- [ ] `POST /v1/tokens` (mint, rate-limited), `GET /v1/me`
- [ ] Verification middleware: bearer token, claims, expiry; anonymous = viewer unless `REQUIRE_AUTH_FOR_READS`
- [ ] Permission map (roles → permissions) and `requires()` per route
- [ ] 401 vs 403 with `requiredPermission` in the problem details
- [ ] Actor from `sub` into revisions; `X-Actor` only when `AUTH_DISABLED`
- **Done when:** a viewer token is refused a write with 403 naming the permission, and revisions record the token's subject
- **Status:** pending

### Phase 6: Foundation record endpoints
Reference: `ropa-api.md` §2, §4; `ropa-packages.md` §4
- [ ] CRUD for parties, agreement terms, agreements, offerings, systems, taxonomies
- [ ] Identifier resolution: id, code or slug in paths and bodies (§1.2)
- [ ] Cursor pagination and per-resource filters (§1.3)
- [ ] Delete semantics: 409 while referenced
- [ ] `GET /{resource}/{ref}/revisions` and `/revisions/{version}`
- **Done when:** the Hireloop parties, offering and agreements can be created through the API
- **Status:** pending

### Phase 7: OpenAPI and docs
Reference: `ropa-api.md` §1.9, `ropa-packages.md` §5.4, §7
- [ ] Generate OpenAPI 3.1 from the Zod schemas
- [ ] `GET /openapi.json`, `GET /api-docs` (Swagger UI), `bearerAuth` scheme
- [ ] Document each operation's required permission (`x-required-permission`)
- [ ] `openapi:write` into `packages/ropa-client/openapi.json`
- **Done when:** Swagger UI can mint a token, authorize, and create a party
- **Status:** pending

### Phase 8: CI and test hardening
Reference: `ropa-database.md` §10, `workspace-skeleton.md` §3.5
> Tests are written test-first inside each phase (see Decisions). This phase is what's
> left over: the CI wiring, the shared Postgres harness, and gap-filling.
- [ ] Vitest against Docker Postgres in CI; migrations once per run; transaction-per-test isolation
- [x] Built-artifact smoke test (`npm run test:dist`), wired into CI — brought forward after it caught a real gap in Phase 2
- [x] Drizzle schema/migration drift check in CI — brought forward with Phase 3
- [ ] Review coverage across phases 1–7 and fill the gaps
- [ ] Enable the commented-out CI drift checks (Drizzle, OpenAPI)
- **Done when:** `npm run check` passes locally and in CI
- **Status:** pending

### Phase 9: Deploy to Render
Reference: `ropa-packages.md` §8, `ropa-database.md` §8.2
- [ ] `render.yaml`: web service (Starter), Render Postgres 18, env group, generated secrets
- [ ] `preDeployCommand: npm run db:migrate`; health check on `/healthz`; build filters
- [ ] First deploy; verify `/healthz`, `/api-docs`, token minting against the deployed service
- [ ] README: the demo tour
- **Done when:** the deployed API serves docs and accepts an authenticated write
- **Status:** pending

## Deferred to build step 2
Activities (discriminated union, role rules, lifecycle, client scoping), the views (`/report`, `/subprocessors`, `/parties/{ref}/impact`, `/data-map`, `/coverage`), review items, `asOf` and `/changes`, the outbox **dispatcher** (rows are written in step 1, delivery comes later), the Markdown report export, and the Hireloop seed script.

## Open questions
1. ~~Express 5 — confirm middleware and async error handling.~~ **Resolved (2026-09-19):** rejected promises from async handlers reach the error middleware unaided; covered by a test.
2. Which Zod→OpenAPI library: `zod-openapi` or `@asteasolutions/zod-to-openapi`? Pick in Phase 7.
3. ~~Logging: anything else needed for Render's log stream?~~ **Resolved (2026-09-19):** JSON at `info`, `pino-pretty` in development, one line per request carrying the problem, a passing `/healthz` at `debug`, `authorization` redacted.
4. ~~Do packages build with tsup from the start, or stay source-only?~~ **Resolved (2026-09-19):** source-only until the first publish.
5. Test isolation: transaction-per-test is in place and works (`test/db/harness.ts`). Still open for the cases that use transactions themselves, such as the dispatcher: a fresh schema per suite, or serialised files? *Phase 8.*

## Decisions
| Decision | Where it came from |
|---|---|
| Auth is built in step 1, before any record is written | Actor can't be retrofitted into revisions (`ropa-api.md` §8) |
| Revisions and outbox rows are written from day one | They can't be recreated later (`ropa-database.md` §8) |
| Foundation records first, activities in step 2 | Activities need every mechanism this step builds |
| **Test-driven throughout.** Tests are written before the code they cover, in the phase that introduces it | User decision, 2026-09-19. Phase 8 becomes CI wiring and gap-filling, not a write-everything-at-once phase |
| **Packages stay source-only** (`main: ./src/index.ts`), tsup added when we first publish | Open question 4, resolved 2026-09-19. Project references already give cross-workspace type-checking; a build step per change buys nothing yet |
| **`dotenv` for local environment loading**, not Node's `--env-file` | User decision, 2026-09-19. Familiar and identical everywhere; Render injects variables directly, so this is a development-only concern |
| Config validates only the variables a phase actually uses | Requiring `DATABASE_URL` before anything connects would break `npm run dev` without Docker. Added in Phase 3 |
| **Packages ship an export map with a `development` condition**: sources for tsx and Vitest, built output for everything else | Phase 2. Node will not strip types inside `node_modules`, so a TypeScript entry point breaks `node dist/index.js` |
| **An unset optional field is returned as `null`, never omitted** | A typed client gets a field that is always present, and OpenAPI stays simple. Enforced by the Output schemas |
| **The built artifact is tested, not just built.** `npm run test:dist` starts `dist/index.js` in CI | Running only the sources hid a `dist/` that could not boot. Brought forward from Phase 8 on 2026-09-20 |
| **The package bundler is chosen at first publish**, not now, and not presumed to be tsup | `tsc` already emits what the workspace needs; tsup's last release was November 2025 and `tsdown` is the active successor. The export map is unchanged either way |
| **`db:migrate` runs the built output**, and the root script builds first | Render sets `NODE_ENV=production` for Node services, so the pre-deploy command cannot rely on `tsx` being installed |
| **Database tests live in one file** until the isolation question is settled | Vitest parallelises files, and a unique constraint blocks across uncommitted transactions. Revisit in Phase 8, open question 5 |
| **Pure single-record rules live in the schemas** (self-party DPO, `endedAt >= signedAt`, Render systems need a region); anything needing another record is the server's job | `ropa-packages.md` §4.3: a form can then show the same error the server would return |

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
| | | |
