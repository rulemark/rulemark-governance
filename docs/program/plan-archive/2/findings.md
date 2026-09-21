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

### Phase 5 (2026-09-20)
- **A module-level singleton is the wrong place for per-app configuration.** The first `requires()` read `REQUIRE_AUTH_FOR_READS` from module state, which every app in a test process would have shared. The switch now lives in `authenticate`, which turns configuration into the anonymous caller's roles, leaving `requires()` reading nothing but the request.
- **A bad token is refused even on a public read.** Falling back to anonymous would hide an expired session behind a page that merely looks emptier than it should.
- **Token claims are validated, not trusted.** Roles travel inside the token, so `verifyToken` parses them against `Principal` rather than handing whatever it finds to the permission map.
- **One message for "unknown subject" and "wrong secret".** Distinguishing them turns the mint endpoint into a directory of valid subjects. The secret comparison is constant-time, and equal-length, so neither the value nor its length leaks.
- **`AUTH_DISABLED` is refused when `NODE_ENV=production`.** It honours `X-Actor`, so anyone could claim to be anyone in the history — a development convenience that must never be a deployment.
- `Permission` and `Role` types are exported from `resources/auth.ts` rather than `enums.ts`, because the schema module owns the name; exporting both caused an ambiguous re-export.
- Express 5 needs async route bodies wrapped (`void (async () => …)()`) when the handler is not itself declared `async`, since the middleware signature returns `void`.

### Phase 6 (2026-09-20)
- **`ON DELETE RESTRICT` raises `restrict_violation` (23001), not `foreign_key_violation` (23503).** 23503 is what a deferred `NO ACTION` check raises. Every foreign key between aggregates is RESTRICT (DB §3), which is exactly what makes the API's "409 while referenced" work, so the handler treats both codes the same. Caught by a delete answering 500 instead of 409.
- **`trust proxy: true` lets any caller bypass IP rate limiting**, by prepending an address to `X-Forwarded-For`; `express-rate-limit` refuses to stay quiet about it. Render puts exactly one proxy in front of the service, so the setting is `1`. This was wrong from Phase 1 and only surfaced once something was rate limited.
- **Vitest file parallelism and one shared database do not mix** once tests commit. `party_one_self` alone makes "which committed row can collide with which uncommitted one" a losing game, so `fileParallelism: false`. The whole suite still runs in about four seconds, and this may well be what the unreproduced flake after the secret rotation was.
- **Endpoint tests cannot use the per-test transaction**, because the router opens its own transaction per write and a handle already inside one does not nest (Phase 4 finding). They commit, prefix everything `hl-`, and clean up in reverse dependency order.
- Reference resolution in list responses loads each referenced table once for the whole page (`domain/refs.ts`), rather than per row.
- `python` edits against files Prettier has reformatted keep missing: match on a line range or a regex instead of an exact block when the block has been through the formatter.

### Phase 7 (2026-09-20)
- **The intermittent test failure is understood and gone.** `request(app)` in supertest starts *and stops an ephemeral HTTP server per call*, and the suite made hundreds per run; occasionally a request was answered by a server that no longer had the expected routes, which showed up as a 404 on a route that plainly exists. Each test file now starts one server and reuses it. Measured: 4 failures in 16 runs before, 1 in 16 after the intermediate fixes, **0 in 20** after. Not proof, but a plausible mechanism plus a fix that removes it.
- Two things found while chasing it, both worth keeping: `docs.test.ts` was handing the router `undefined` as a database, so a public read turned a routing check into a crash; and the auth tests were building a fresh app per assertion, which is neither cheap nor necessary.
- **Zod 4 converts to JSON Schema natively** (`z.toJSONSchema`, draft 2020-12 — the dialect OpenAPI 3.1 uses), so open question 2 is answered with "neither library". Every schema converts cleanly, refinements included, and `io: 'input' | 'output'` reproduces the Input/Output split exactly: a field with a default is optional going in and present coming out.
- **The document is generated from the same `ResourceDefinition` objects as the router**, so an endpoint cannot exist undocumented or be documented with the wrong permission. Filters became declarative for the same reason; they were functions, which a document cannot describe.
- A generator is exactly the thing that can produce plausible nonsense, so the document is validated as OpenAPI 3.1 by a test, and a second test asserts every documented route is routable — verified to fail by documenting a path the router does not serve.

### Phase 8 (2026-09-20)
- **The README's getting-started did not work.** `npm run db:seed` was in the quickstart and in the root scripts, but the seed is step 2, so a clone failed on step four. The script is gone and the README says where demo data comes from instead.
- **Formatting was never checked.** `npm run format` writes but nothing verified, so drift accumulated silently. `format:check` now runs in CI — and it immediately found seven files, including generated ones. Generated files (`drizzle/`, `openapi.json`) are Prettier-ignored: formatting them puts Prettier and the generator in a fight the drift check then reports as a failure.
- **`npm run check` did not mean what CI means.** It now runs typecheck, lint, format:check, test and test:dist, so "it passes locally" and "it passes in CI" are the same claim.
- **Seven exported symbols nothing used.** `hasPermission`, `arrayInList`, `referencedElsewhere` and an exported `loadEnvFile` were removed; `TOKEN_ISSUER`/`TOKEN_AUDIENCE` earned their keep with a test pinning the claims §1.9 specifies. The seventh, `SNAPSHOT_SCHEMAS`, turned out to mark a real gap.
- **Snapshots were validated on write but not on read**, though DB §6.2 asks for both. `GET /{ref}/revisions/{version}` now parses the stored snapshot before returning it: a snapshot that no longer matches its schema is how an aggregate's shape changed without an upgrader, and returning it quietly would hand a caller history that does not mean what it says.
- **Coverage's zero-percent files were an artifact, not a gap.** The bootstrap, the migrator and the OpenAPI writer all run in child processes, so v8 sees none of their lines although each is covered. They are excluded from the report with that reason written down, rather than counted as untested or papered over with shallow tests.

### Demo data over HTTP (2026-09-20)
- **Seeding through the API cannot replace `db:seed`.** DB §9 replays the story's timeline by backdating `valid_from`, and that option is deliberately not exposed over HTTP (API §1.6), so anything loaded through the API is stamped now and `asOf` sees a single moment. The two coexist: `demo:data` for something to look at and for environments we have no database access to, `db:seed` for the timeline, with activities, in step 2.
- **The demo loader needs an admin.** Taxonomy writes need `taxonomy:write`, which only `admin` carries, and neither principal in `.env.example` had it. Added `svc:seed`, which also demonstrates the service-role idea from §1.9.
- **Tests now use their own database, beside the development one.** Loading demo data broke twelve tests: a committed `self` party makes `party_one_self` reject every other one, including inside a transaction that rolls back, because a unique index sees committed rows regardless. Sharing a server but not a database is the fix; `test/db/global-setup.ts` creates `<database>_test` if it is missing. Tests were already robust to *rows*, but could never have been robust to a globally unique constraint.
- The dataset is validated by a test against the same Input schemas the API uses, including that every reference points at a record defined *earlier* in the list — a forward reference would pass against an already-seeded database and fail only on a fresh one.

### Phase 9, Render by hand (2026-09-21)
- **Render suffixes the database name.** Asking for `ropa` produced `ropa_rcz5`; it is made unique rather than ignored. Nothing depends on it — `fromDatabase` injects the whole `DATABASE_URL` — but the "local and deployed read the same" argument for setting it only half holds. The **user** was accepted verbatim (`ropa`).
- Render's hierarchy is workspace → project → environment → services. The governance suite goes in one project and one environment, because the services are designed to reach each other over the private network. **Unverified:** whether private networking is scoped per environment or per workspace; it decides whether a `staging` environment must be a complete second copy.
- The free database instance type expires after 30 days regardless of the account plan, so a Pro workspace still has to choose a paid instance deliberately.
- Decisions taken at creation, none of them changeable afterwards: name `ropa-db`, database `ropa_rcz5`, user `ropa`, version **18** (required for `uuidv7()`), region **Frankfurt** (must match the web service, or there is no private network).

### Unbounded strings, found by reading the generated docs (2026-09-21)
- **A pattern says what a value looks like, not how much of it there may be.** `Slug` had a regex and no `maxLength`, so the API accepted a 5,000-character slug; `legalName` and the other free-text fields were capped only by the 1 MB body limit. Postgres did not help: `slugCheck` enforced shape, and the columns are `text`. Every identifier and text field is now bounded in `primitives.ts`, and `slugCheck` bounds length too — the safety net belongs in the layer that is true whatever writes the row (DB §2).
- **This was found by looking at Swagger UI.** The example generator produced a 4,000-character slug, because that is a legal value under the old schema. Generated documentation showing an absurd example is documentation telling you something true.
- **`drizzle-kit` reads a workspace package through its built output.** Importing `MAX_SLUG` into the Drizzle schema and generating without rebuilding produced `length(slug) <= undefined` — valid SQL, and meaningless, exactly like the `$1` placeholders in Phase 3. `db:generate` now builds first, like `db:migrate` and `openapi:write`, and a test fails on any check constraint containing `undefined` or `NaN`.
- Schemas now carry `.meta({ examples })`, which Zod passes into JSON Schema, so the rendered docs show `mailcrest` rather than a wall of generated text.

### `trust proxy` was off by one, found in a production log line (2026-09-21)
- **Two proxies sit in front of the service on Render, not one.** A real request arrives with `remoteAddress` set to Render's internal proxy and `x-forwarded-for: <caller>, <Cloudflare edge>` — Render's edge is itself behind Cloudflare (`cf-ray`, `cdn-loop: cloudflare`).
- `trust proxy: 1`, set in Phase 6 after `express-rate-limit` refused to accept `true`, therefore resolved `req.ip` to **the Cloudflare edge address**, not the caller. The token rate limiter keys on `req.ip`, so every caller arriving through one edge shared a single bucket of 20 attempts per 15 minutes. Strict rather than lax, so not a hole — but wrong, and it would have locked out innocent callers under any real traffic.
- It is now `2`, and **pinned by a test rather than by a guess**: `trust-proxy.test.ts` drives the real forwarding chain through supertest and asserts `req.ip` is the caller. It failed for exactly the right reason before the change. A second case proves a caller who prepends their own address is still ignored, because Cloudflare appends the address it observed, leaving a forged entry outside the trusted hops.
- The request log now carries `client.ip` and `client.ips`. This setting's mistakes are otherwise invisible — nothing in a log said which address the limiter was keying on.
- The number encodes Render's current topology. If they put something else in front, the test is what should fail; that is the point of having one.

### What Render actually did, against what the design assumed (2026-09-21)
- **A Blueprint adopts existing resources by name.** The first sync offered "Associate existing services" rather than creating duplicates, and applying it moved no data. The uncertainty flagged before any of this was created turned out to be unfounded — but only because the names matched.
- **Names must match exactly, capitalisation included.** `production` in the file read as a *different* environment from the dashboard's `Production`, and the plan offered to create one and move both resources into it. Non-destructive, but it would have left an empty environment behind. Changing one letter made three lines of the plan disappear.
- **Private networking is scoped to an environment.** `networking.isolation` is an environment-level key, which settles the question raised before the project was created: the suite's services must share an environment to reach each other privately, and a `staging` environment is a complete second copy, its own database included.
- **Read the plan, then shorten the diff.** Two lines of the first plan were noise: `rootDir: .` restated a default that had been left blank, and the environment mismatch above. A Blueprint that describes what exists should produce a short plan; a long one usually means the file is wrong, not the platform.
- **Associating a database changes nothing about it.** `ropa-db` showed no update after the sync because every setting already matched — association is metadata. The service redeployed because it had two real changes.
- `NODE_ENV` was never an explicit variable: Render sets it for the Node runtime. Declaring it makes it visible in the dashboard and in the file.
- **From now on the dashboard is not where changes are made.** Both resources are Blueprint-managed, so a dashboard edit is overwritten by the next sync. The exception is `PRINCIPALS`, which is `sync: false` precisely so it can differ per environment without living in the repository.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
