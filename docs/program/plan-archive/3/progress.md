# Progress Log — Build Step 2

> Step 1's log is archived in `plan-archive/2/progress.md`.

## Session: 2026-09-21
- Archived build step 1's planning files to `docs/program/plan-archive/2/`
- Wrote the build step 2 plan (8 phases) in `task_plan.md`
- Step 2 is the design's own step 2 (`ropa-api.md` §8): activities, then
  `/subprocessors` and `/report` — enough for story chapters 2–4. `asOf`,
  `/changes` and the dispatcher stay in step 4; the other views in step 3

## Session: 2026-09-26
- Resolved open question 1: the activity is a discriminated union on `role`,
  with forbidden-by-role as field-level checks. Tested against Zod 4.6.5
  first; the evidence is in findings.md. Phase 1's checklist now spells out
  the shape
- Renamed permission roles to `PRINCIPAL_ROLES` / `PrincipalRole` /
  `PRINCIPAL_ROLE_PERMISSIONS` (`9406ac5`), so a bare "role" means the GDPR
  sense. No database or wire change; the OpenAPI document regenerates
  identically
- **Phase 1 complete.** In `@rulemark/ropa-schemas`: `ActivityInput` /
  `Activity` with nested engagements, transfers, retention rules and both
  client scopes (`resources/activity.ts`); the DM §5 table,
  `describeRoleRules` and `canActivate` (`resources/activity-role-rules.ts`);
  `validateActivityShape`. `fieldErrorsFromZod` moved from the API app into
  the package and reads a rule's own code. Tests written first
- **Phase 2 complete.** The activity aggregate's eleven tables
  (`src/db/schema/activity.ts`), `arrayInList` in `checks.ts`, and
  migrations `0003_activity_aggregate` (generated, reviewed against DB §4.4)
  and `0004_activity_triggers` (hand-written). 35 constraint tests in
  `test/db/activity-schema.test.ts`, written first; the table-list test in
  `schema.test.ts` now expects them
- **Phase 3 complete.** Saving the activity aggregate with its children
  (`src/domain/activity/`), on the generic save with a new `afterWrite` hook;
  `ActivitySnapshot` in the snapshot registry. 28 tests in
  `test/db/activity-save.test.ts`, written first. Open question 3 resolved:
  the root's `If-Match` is enough
- **Phase 4 complete.** `/v1/activities` with the seven record routes,
  `activate` and `retire`, and nine filters (`src/api/resources/activities.ts`),
  on router extensions for custom saves, actions and new filter kinds; the
  lifecycle in `src/domain/activity/lifecycle.ts`; the response shape in
  `output.ts`; a batched loader. `openapi.json` regenerated (additive). 37
  HTTP tests in `test/db/activity-endpoints.test.ts`, written first
- **Phase 5 complete.** `GET /v1/subprocessors` by offering or client
  (`api/routes/views.ts`), over pure functions in `domain/views/`;
  `SubprocessorsQuery` and `SubprocessorsResponse` in the package's new
  `views` module; the agreement rule moved to `domain/agreements.ts`. Open
  question 4 resolved: views over aggregates. 13 unit tests, 12 HTTP tests
  and 2 package tests, written first
- **Phase 6 complete.** `GET /v1/report` in JSON and Markdown, scoped by
  offering or client, closing with the subprocessor list
  (`api/views/report.ts`, `markdown.ts`); one scoping function shared with
  `/subprocessors`; `ReportQuery` and `ReportResponse` in the package. Open
  question 2 resolved: template strings. 12 renderer tests (one golden), 17
  HTTP tests, 4 package tests
- **Phase 7 complete.** `npm run db:seed [-- --reset]` replays the story
  through the domain layer, backdated, idempotent (`src/demo/replay.ts`,
  `replay-story.ts`, `story.ts`); the dataset aligned with the story's cast;
  `inputFromSnapshot`; `databaseUrlOrExit`. 11 seed tests and 2 round-trip
  tests; run end to end on a throwaway database
- **Phase 8 complete, and with it build step 2.** Deployed through
  `2017347` (the narrow migrator config), pushed alone after the first push
  was skipped by the build filter. Production reset and seeded from the
  Render Shell; the views, history and Markdown report verified on the live
  service; README tour extended to the record, the lifecycle and the push rule
- **Step 1 carry-overs closed.** `demo:data` loads the activities and reads
  only its own configuration (`0bfbffb`, deployed); `ropa-db` blocks external
  connections (`3a4f7c5`, via the Blueprint). Today's decisions for steps 3–5
  written into `ropa-api.md` §5, §8, §9 and DM §3.8

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 1 | `npm run check` | 422 tests pass | 422 pass | ✅ |
| Principal role rename | `npm run typecheck && npm run lint && npm test` | Clean, all pass | Clean; 314 + 104 pass | ✅ |
| Phase 1: the activity shape | `npm run check` | Clean, all pass | Clean; 311 + 180 + 4 pass (3 tests moved from the app to the package) | ✅ |
| Retention periods aligned | `npm run check` | Clean, all pass | Clean; 311 + 192 + 4 pass | ✅ |
| Phase 2: the activity tables | `npm run check`; `drizzle-kit generate` | Clean, all pass; no pending changes | Clean; 346 + 192 + 4 pass; "No schema changes" | ✅ |
| Phase 3: saving with children | `npm run check`; diff broken on purpose | Clean, all pass; the diff tests fail when deletes are skipped | Clean; 374 + 192 + 4 pass; 3 tests failed as expected, then restored | ✅ |
| Phase 4: endpoints and lifecycle | `npm run check`; role rules disabled on purpose; `openapi.json` compared as JSON | Clean, all pass; role-rule tests fail when disabled; only additions | Clean; 421 + 194 + 4 pass; 3 tests failed as expected, then restored; no path or schema removed or changed | ✅ |
| Phase 5: `/subprocessors` | `npm run check`; every engagement made effective on purpose; `openapi.json` compared as JSON | Clean, all pass; the Ch4 tests fail; only additions | Clean; 447 + 196 + 4 pass; 6 tests failed as expected, then restored; one path, one schema, two tags added | ✅ |
| Phase 6: `/report` | `npm run check`; anchors built from names on purpose; `openapi.json` compared as JSON | Clean, all pass; the anchor tests fail; only additions | Clean; 477 + 200 + 4 pass; 4 tests failed as expected, then restored; one path and one schema added | ✅ |
| Phase 7: the seed | `npm run check`; backdating removed on purpose; `db:migrate` + `db:seed -- --reset` twice on a throwaway database; production guard | Clean, all pass; date tests fail; 71 applied then 71 already there; guard refuses | Clean; 490 + 200 + 4 pass; 2 tests failed as expected, then restored; as expected; exit 1, data untouched | ✅ |
| Narrow migrator config | `npm run check` (incl. `test:dist`: migrator with secrets blanked) | Clean, all pass | Clean; 493 + 200 + 5 pass | ✅ |
| Phase 8: deployed | push `2017347` alone → CI → Render; seed in Render Shell; live checks | Deploy live; 71 applied; views and report as the story | Live ~1 min after CI; 71 applied, 0 already there; as expected; 14 of 14 tour links 200 | ✅ |
| Carry-overs | `npm run check`; edit idempotency removed on purpose; deploy of `0bfbffb` | Clean, all pass; the second-run test fails; live | Clean; 500 + 202 + 5 pass; 1 test failed as expected, then restored; uptime reset after CI | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | **Build step 2 is complete.** Eight phases, all green, deployed, and the live record replays the story |
| Where am I going? | Activities and their rules, then `/subprocessors` and `/report`, then the Hireloop seed |
| What's the goal? | Make the record a record: an Art. 30 entry that can be drafted, activated and read |
| What have I learned? | See findings.md, and `plan-archive/2/findings.md` for step 1 |
| What have I done? | Step 1 complete: the foundation records, auth, history and events, deployed on Render from a Blueprint |
