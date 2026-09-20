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

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Phase 1 suite (40 tests, 4 files) | `npm run test` | all pass | all pass | ✅ |
| Typecheck, sources and tests | `npm run typecheck` | clean | clean | ✅ |
| Lint | `npm run lint` | clean | clean | ✅ |
| Build | `npm run build` | `dist/` without test files | as expected | ✅ |
| Dev server | `PORT=3999 npm run dev` | `/healthz` 200, 404 as problem+json | as expected | ✅ |
| Built output, production mode | `NODE_ENV=production node dist/index.js` | JSON logs, one line per request, clean SIGTERM exit | as expected | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 1, Phase 1 complete; Phase 2 (shared schemas package) next |
| Where am I going? | Phases 2–9: schemas, database, persistence, auth, endpoints, OpenAPI, CI, deploy |
| What's the goal? | A running, authenticated, documented API on Render with foundation records working end to end |
| What have I learned? | See findings.md |
| What have I done? | Design complete and pushed; monorepo scaffolded; the API app boots, logs, handles errors and shuts down cleanly, under test |
