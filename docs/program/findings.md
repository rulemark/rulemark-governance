# Findings & Decisions — Build Step 1

> Design-phase findings are archived in `plan-archive/1/findings.md`. This file carries
> forward only what still matters for building, plus what we learn while building.

## Reference documents
- `docs/ropa/ropa-api.md` — API contract (auth §1.9, conventions §1, endpoints §2, build order §8)
- `docs/ropa/ropa-data-model.md` — entities, rules, aggregates, versioning
- `docs/ropa/ropa-database.md` — DDL, constraints, save algorithm, migrations
- `docs/ropa/ropa-packages.md` — package boundary, client design, Render topology
- `docs/ropa/ropa-story.md` — Hireloop scenario; the acceptance scenarios and seed data
- `docs/program/workspace-skeleton.md` — repo layout, tooling, CI

## Verified platform facts (2026-09-19)
- Render pre-deploy command: after build, before deploy, separate instance; failure fails the deploy; paid instances only. Workspace is on **Pro**.
- Render Postgres supports majors 13–18; we require **18** for built-in `uuidv7()`.
- Drizzle: `check()`, `unique()`, partial indexes via `.where(sql…)`, custom migrations (`drizzle-kit generate --custom`), runtime `migrate()` from `drizzle-orm/node-postgres/migrator`.
- Not yet verified: Drizzle syntax for `FOR UPDATE SKIP LOCKED` (fallback: `sql` template) and `nullsNotDistinct()` (fallback: custom migration).
- TypeScript pinned to ^5.9: `typescript-eslint` peer-requires `<6.1`, while TypeScript 7 is released.
- Prettier ignores markdown (its table padding rewrote every design doc).

## Environment
- Repo: `rulemark/rulemark-governance` (private), default branch `main`.
- Identity pinned per repo: `core.sshCommand` → `~/.ssh/id_ed25519_rulemark`; author `matt@rulemark.io`; commits signed; `.githooks/pre-push` guards account, org and author.
- Local Postgres: `docker compose up -d db` (Postgres 18.6, `postgres://ropa:ropa@localhost:5432/ropa`), with a `pg_isready` healthcheck so the container reports readiness.
- **The `postgres:18` volume mount is `/var/lib/postgresql`, not `/var/lib/postgresql/data`.** From 18 the image keeps data in a major-version subdirectory (`/var/lib/postgresql/18/docker`) so `pg_upgrade --link` works across a version bump; mounting the old path makes the entrypoint refuse to start with exit code 1 (docker-library/postgres#1259). Verified 2026-09-20: `uuidv7()` is available with no extension, as the schema design assumes.

## Build findings

### Phase 1 (2026-09-19)
- **Express 5 forwards rejected promises** from async handlers to the error middleware, with no wrapper (open question 1, resolved). Covered by a test in `app.test.ts`.
- **`pino-http` invents its own error on a 5xx.** It logs `res.err` if set, otherwise a bare `Error("failed with status code 500")`, and the real stack is lost. The error handler sets `res.err` for 5xx only.
- **One log line per request.** The error handler leaves the problem on `res.locals.problem` and `customProps` folds it into `pino-http`'s completion line, rather than logging separately. Logging in both places produced two lines per failure.
- **A passing health check logs at `debug`**, so Render's constant polling is silent at `info` while a *failing* check still logs at `warn`/`error` (open question 3, resolved). `autoLogging.ignore` was the first attempt and would have hidden failures too.
- **A pino `transport` and an explicit destination are mutually exclusive**, so `createLogger` takes an optional destination and skips `pino-pretty` when one is given. This is what lets tests assert the real redaction rules instead of a stand-in logger.
- **Internal error detail is exposed in `development` only**, not "any non-production". With `test` treated as non-production, a test asserting that a connection string does not leak was passing a connection string straight through.
- **`moduleResolution: "bundler"` still emits plain ESM**, so relative imports must be written with a `.js` extension or `node dist/index.js` cannot resolve them. `tsx` hides this in development.
- **Tests that spawn the service must resolve paths from `import.meta.url`.** `process.cwd()` differs between `npm test -w apps/ropa-api` and a run from the repository root.
- `npm install` warns that `esbuild` and `fsevents` have unapproved install scripts. The platform binaries are present and `tsx` works, so nothing was approved.

### Phase 2 (2026-09-19)
- **Node will not strip types inside `node_modules`**, so a workspace package whose entry point is TypeScript cannot be loaded by `node dist/index.js`. Source-only packages break the production build the moment the app actually imports one. Fixed with **export conditions**: `development` → `./src/*.ts` for tsx and Vitest, `default` → `./dist/*.js` for everything else. `npm run dev` and the spawned test service pass `--conditions=development`; both `vitest.config.ts` files set `resolve.conditions`.
- **Test type-checking must follow test resolution.** `tsconfig.test.json` sets `customConditions: ["development"]` so tests are type-checked against the same sources Vitest runs, instead of against `dist/*.d.ts` that may not have been built yet.
- **`tsc --build` trusts `.tsbuildinfo` over reality.** Deleting `dist/` by hand leaves the build thinking it is current and it silently emits nothing. `--force` is the escape hatch; CI is unaffected because a fresh clone has no build info.
- **Zod 4 `z.looseObject`** is what keeps RFC 9457 extension members (`requiredPermission`, `requestId`); a plain `z.object` silently drops exactly the part a caller needs most.
- **A refined schema cannot be extended.** `PartyInput` is `.superRefine`d for the self-party DPO rule, so the plain object is exported separately as `PartyInputBase` for anything that needs `.extend()` or `.partial()` later.
- `RENDER_SYSTEM_KINDS` is **derived** from `SYSTEM_KINDS` by prefix rather than written out twice, so a new Render kind cannot be missed by the region rule.
- ESLint's `no-unused-vars` needed `ignoreRestSiblings` and a `^_` pattern: omitting a key by destructuring (`const { region: _region, ...rest }`) is the natural way to test a missing field.

### Between phases 2 and 3 (2026-09-20)
- **The test suite could not see a broken build.** Every test ran the TypeScript sources through `tsx`, which resolves workspace packages to *their* sources, so `node dist/index.js` was broken while 149 tests stayed green. `apps/ropa-api/test/dist.test.ts` now starts the built artifact the way Render does and is wired into CI after `npm run build`. Verified by reintroducing the original bug: the ordinary suite still passed, the dist suite failed with `ERR_MODULE_NOT_FOUND` in its output.
- **tsup has gone quiet** (last release November 2025); `tsdown`, from the Rolldown team, is where the activity is. Neither is deprecated. `ropa-packages.md` §7 and `workspace-skeleton.md` §3.3 now record that the packages build with plain `tsc` and that the bundler is chosen at first publish, against whatever is current then.

### Phase 3 (2026-09-20)
- **A check constraint built from bound values is not a constraint.** `sql`${value}`` inside `inList` made drizzle-kit emit `CHECK (kind IN ($1, $2, $3, $4))` for every enum in all eleven tables. Literals must be inlined with `sql.raw`, quotes escaped. Caught by reading the generated SQL, which is exactly why §8.1 says to review it; a test now asserts no `check_clause` in `information_schema` contains `$1`.
- **Drizzle auto-names a column-level unique constraint from the TypeScript property**, giving `system_renderResourceId_unique`. Constraint names are `<table>_<meaning>` (§3), so the name is passed explicitly: `text().unique('system_render_resource_id')`.
- **Postgres aborts the whole transaction when a statement fails** (25P02), so a test that expects a violation and then keeps going needs a `SAVEPOINT` around the failing statement. The harness wraps every expectation in one.
- **Drizzle wraps driver errors**, so `error.constraint` is undefined and the real one is on `error.cause`. The harness checks both; asserting on the *named* constraint matters, because "it threw" also passes when the row was rejected for an unrelated reason.
- **A second entry point exposed `.env` loading in the wrong place.** The migrator is its own process and had no dotenv call. Loading the file and failing fast on bad configuration now live in `src/shared/startup.ts`, shared by the service and the migrator.
- **`db:migrate` runs the built output, not tsx.** Render sets `NODE_ENV=production` for Node services, so `npm ci` there can skip devDependencies and `tsx` would not exist at pre-deploy time.
- **The CI drift check uses `git status`, not `git diff`.** A newly generated migration is an untracked file, which `git diff --exit-code` does not see.
- Vitest runs test files in parallel, and a unique constraint blocks across uncommitted transactions, so the database tests live in one file for now. Revisit with the isolation question in Phase 8.

### Phase 4 (2026-09-20)
- **A deletion needs its own revision version.** Writing the deletion revision with the deleted row's version collides with `revision_version_once`: that version was already spent on the revision that created the state. The deletion is version N+1, which also keeps `snapshot.version` equal to `revision.version` — the invariant an `asOf` read relies on.
- **`db.transaction()` on a handle that is already inside a transaction is not a savepoint.** Drizzle issues a real `BEGIN`/`ROLLBACK` on a database handle; only a `PgTransaction` nests as a savepoint. In the test harness, which opens its own `BEGIN`, that ended the outer transaction and left the rest of the test autocommitting — which silently committed rows and broke unrelated tests. The harness now documents this and offers `savepoint()` and `withRealTransaction()`.
- **A test that alters schema can corrupt the database.** A cleanup that did `ALTER TABLE revision DISABLE TRIGGER`, then threw on a foreign key before re-enabling, left `revision_append_only` disabled for every later run. The lesson stuck: nothing in a test disables a constraint, and the committing test now deletes only its own record and leaves history alone, because that is what append-only means.
- **Database tests must not assume an empty table.** Once any test commits, unscoped assertions (`select().from(party)`, `DELETE FROM revision`) pick up other tests' rows and report their errors. Every assertion is now scoped by id or slug, and counter assertions are relative rather than absolute.
- The `Transaction` type covers a `Database` as well as Drizzle's transaction handle: a connection can already be inside a transaction without Drizzle having opened it, which is how the harness isolates tests and how a caller holding a checked-out client works.
- `Problem` moved from `src/api/` to `src/shared/`, so the domain can throw the app's error vocabulary without depending on the HTTP layer.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
