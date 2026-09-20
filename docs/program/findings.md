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
- Local Postgres: `docker compose up -d db` (Postgres 18, `postgres://ropa:ropa@localhost:5432/ropa`).

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

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
